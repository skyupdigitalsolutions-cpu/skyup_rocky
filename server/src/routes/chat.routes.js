import { Router } from 'express';
import { z } from 'zod';
import { Conversation, Message } from '../models/Conversation.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission, canAccessClient } from '../middleware/rbac.js';
import { PERMISSIONS } from '../config/rbac.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { audit } from '../middleware/audit.js';
import { answerQuestion } from '../orchestrator/index.js';

const router = Router();
router.use(requireAuth, requirePermission(PERMISSIONS.CHAT_USE));

router.get(
  '/conversations',
  asyncHandler(async (req, res) => {
    const conversations = await Conversation.find({ user: req.user._id }).sort({ lastMessageAt: -1 }).lean();
    res.json({ conversations });
  })
);

const contextSchema = z.object({
  client: z.string().nullable().optional(),
  dateRange: z
    .object({
      preset: z.string().optional(),
      start: z.string().nullable().optional(),
      end: z.string().nullable().optional(),
    })
    .optional(),
  service: z.string().optional(),
});

router.post(
  '/conversations',
  asyncHandler(async (req, res) => {
    const context = contextSchema.parse(req.body?.context || {});
    if (context.client && !canAccessClient(req.user, context.client)) {
      throw new HttpError(403, 'Client not in your scope');
    }
    const conversation = await Conversation.create({ user: req.user._id, context });
    res.status(201).json({ conversation });
  })
);

router.get(
  '/conversations/:id/messages',
  asyncHandler(async (req, res) => {
    const conversation = await Conversation.findOne({ _id: req.params.id, user: req.user._id });
    if (!conversation) throw new HttpError(404, 'Conversation not found');
    const messages = await Message.find({ conversation: conversation._id }).sort({ createdAt: 1 }).lean();
    res.json({ conversation, messages });
  })
);

const messageSchema = z.object({
  content: z.string().min(1),
  context: contextSchema.optional(),
});

router.post(
  '/conversations/:id/messages',
  asyncHandler(async (req, res) => {
    const { content, context } = messageSchema.parse(req.body);
    const conversation = await Conversation.findOne({ _id: req.params.id, user: req.user._id });
    if (!conversation) throw new HttpError(404, 'Conversation not found');

    if (context) {
      if (context.client && !canAccessClient(req.user, context.client)) {
        throw new HttpError(403, 'Client not in your scope');
      }
      conversation.context = { ...conversation.context, ...context };
    }
    if (conversation.context?.client && !canAccessClient(req.user, conversation.context.client)) {
      throw new HttpError(403, 'Client not in your scope');
    }

    await Message.create({ conversation: conversation._id, role: 'user', content });

    const history = (await Message.find({ conversation: conversation._id }).sort({ createdAt: 1 }).lean())
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }));

    const { answer, grounding, meta, action } = await answerQuestion({
      user: req.user,
      question: content,
      context: conversation.context,
      history: history.slice(0, -1),
    });

    const assistantMsg = await Message.create({
      conversation: conversation._id,
      role: 'assistant',
      content: answer,
      grounding,
    });

    if (conversation.title === 'New conversation') {
      conversation.title = content.slice(0, 60);
    }
    conversation.lastMessageAt = new Date();
    await conversation.save();

    await audit(req, 'chat.query', {
      targetType: 'conversation',
      targetId: conversation._id,
      meta: {
        client: conversation.context?.client || 'all',
        model: meta?.model,
        action: action?.type || null,
      },
    });

    // `action` carries structured data for the UI (schedule card, etc.)
    // It's not stored in the DB — the source of truth is the ScheduledPost collection.
    res.json({ message: assistantMsg, grounding, action: action || null });
  })
);

export default router;