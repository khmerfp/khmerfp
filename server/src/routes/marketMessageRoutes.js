import { Router } from 'express';
import { getDatabasePool } from '../config/database.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { getAuthenticatedUser } from '../services/authSessionService.js';

const MARKET_ID_PATTERN = /^[a-zA-Z0-9_-]{1,100}$/;
const POST_ID_PATTERN = /^[1-9]\d{0,18}$/;
const MAX_POST_ID = 9223372036854775807n;
const REACTIONS = new Set(['like', 'love', 'care', 'haha', 'wow', 'sad', 'angry']);

export function createMarketMessageRouter({
  getPool = getDatabasePool,
  authGuard = requireAuth,
  getUser = getAuthenticatedUser,
} = {}) {
  const router = Router();

  router.get('/:marketId/messages', async (request, response) => {
    const { marketId } = request.params;
    if (!MARKET_ID_PATTERN.test(marketId)) {
      return response.status(400).json({ message: 'Invalid market ID.' });
    }

    const database = getPool();
    const viewer = request.authUser || await getUser(request);
    const viewerId = viewer?.id ?? null;
    const postsResult = await database.query(
      `SELECT post.id, post.market_id AS "marketId", post.user_id AS "userId",
              post.username AS "user", post.message AS text, post.created_at AS added,
              (SELECT COALESCE(jsonb_object_agg(counts.reaction, counts.count), '{}'::jsonb)
               FROM (
                 SELECT reaction, COUNT(*)::int AS count
                 FROM market_message_reactions WHERE message_id = post.id
                 GROUP BY reaction
               ) counts) AS "reactionCounts",
              (SELECT reaction FROM market_message_reactions
               WHERE message_id = post.id AND user_id = $2) AS "myReaction"
       FROM (
         SELECT id, market_id, user_id, username, message, created_at
         FROM market_messages
         WHERE market_id = $1 AND parent_id IS NULL
         ORDER BY created_at DESC, id DESC
         LIMIT 50
       ) post
       ORDER BY added ASC, post.id ASC`,
      [marketId, viewerId],
    );

    const posts = postsResult.rows.map((post) => ({ ...post, replies: [] }));
    if (posts.length) {
      const repliesResult = await database.query(
        `SELECT reply.id, reply.market_id AS "marketId", reply.parent_id AS "parentId",
                reply.user_id AS "userId", reply.username AS "user", reply.message AS text,
                reply.created_at AS added,
                (SELECT COALESCE(jsonb_object_agg(counts.reaction, counts.count), '{}'::jsonb)
                 FROM (
                   SELECT reaction, COUNT(*)::int AS count
                   FROM market_message_reactions WHERE message_id = reply.id
                   GROUP BY reaction
                 ) counts) AS "reactionCounts",
                (SELECT reaction FROM market_message_reactions
                 WHERE message_id = reply.id AND user_id = $3) AS "myReaction"
         FROM (
           SELECT id, market_id, parent_id, user_id, username, message, created_at,
                  ROW_NUMBER() OVER (
                    PARTITION BY parent_id ORDER BY created_at ASC, id ASC
                  ) AS reply_number
           FROM market_messages
           WHERE market_id = $1 AND parent_id = ANY($2::bigint[])
         ) reply
         WHERE reply_number <= 20
         ORDER BY parent_id, added ASC, reply.id ASC`,
        [marketId, posts.map((post) => post.id), viewerId],
      );
      const postsById = new Map(posts.map((post) => [String(post.id), post]));
      for (const reply of repliesResult.rows) {
        postsById.get(String(reply.parentId))?.replies.push(reply);
      }
    }

    response.status(200).json({ messages: posts });
  });

  router.post('/:marketId/messages', authGuard, async (request, response) => {
    const { marketId } = request.params;
    const { parentId = null, text } = request.body ?? {};

    if (!MARKET_ID_PATTERN.test(marketId)) {
      return response.status(400).json({ message: 'Invalid market ID.' });
    }
    if (typeof text !== 'string') {
      return response.status(400).json({ message: 'Message is required.' });
    }
    const message = text.trim();
    if (!message || message.length > 500) {
      return response.status(400).json({
        message: 'Message must be 1–500 characters.',
      });
    }

    let replyTo = null;
    if (parentId !== null) {
      if (
        (typeof parentId !== 'string' && typeof parentId !== 'number')
        || (typeof parentId === 'number' && !Number.isSafeInteger(parentId))
      ) {
        return response.status(400).json({ message: 'Invalid reply post.' });
      }
      replyTo = String(parentId);
      if (!POST_ID_PATTERN.test(replyTo) || BigInt(replyTo) > MAX_POST_ID) {
        return response.status(400).json({ message: 'Invalid reply post.' });
      }

      const parentResult = await getPool().query(
        `SELECT id FROM market_messages
         WHERE id = $1 AND market_id = $2 AND parent_id IS NULL`,
        [replyTo, marketId],
      );
      if (!parentResult.rowCount) {
        return response.status(404).json({ message: 'Post not found.' });
      }
    }

    const userId = request.authUser.id;
    const username = String(request.authUser.display_name || request.authUser.email || 'User')
      .trim()
      .slice(0, 80) || 'User';

    const result = await getPool().query(
      `INSERT INTO market_messages (market_id, user_id, parent_id, username, message)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, market_id AS "marketId", parent_id AS "parentId",
                 user_id AS "userId", username AS "user", message AS text,
                 created_at AS added`,
      [marketId, userId, replyTo, username, message],
    );

    response.status(201).json({
      message: {
        ...result.rows[0],
        reactionCounts: {},
        myReaction: null,
        replies: [],
      },
    });
  });

  router.put('/:marketId/messages/:messageId/reaction', authGuard, async (request, response) => {
    const { marketId, messageId } = request.params;
    const { reaction } = request.body ?? {};

    if (!MARKET_ID_PATTERN.test(marketId) || !POST_ID_PATTERN.test(messageId)
      || BigInt(messageId) > MAX_POST_ID) {
      return response.status(400).json({ message: 'Invalid market or message ID.' });
    }
    if (reaction !== null && !REACTIONS.has(reaction)) {
      return response.status(400).json({ message: 'Choose a valid reaction or clear your current reaction.' });
    }

    const database = getPool();
    const messageResult = await database.query(
      'SELECT id FROM market_messages WHERE id = $1 AND market_id = $2',
      [messageId, marketId],
    );
    if (!messageResult.rowCount) {
      return response.status(404).json({ message: 'Message not found.' });
    }

    if (reaction !== null) {
      await database.query(
        `INSERT INTO market_message_reactions (message_id, user_id, reaction)
         VALUES ($1, $2, $3)
         ON CONFLICT (message_id, user_id)
         DO UPDATE SET reaction = EXCLUDED.reaction, created_at = NOW()`,
        [messageId, request.authUser.id, reaction],
      );
    } else {
      await database.query(
        'DELETE FROM market_message_reactions WHERE message_id = $1 AND user_id = $2',
        [messageId, request.authUser.id],
      );
    }

    const reactionsResult = await database.query(
      `SELECT COALESCE(jsonb_object_agg(reaction, count), '{}'::jsonb) AS "reactionCounts"
       FROM (
         SELECT reaction, COUNT(*)::int AS count
         FROM market_message_reactions
         WHERE message_id = $1
         GROUP BY reaction
       ) counts`,
      [messageId],
    );
    response.status(200).json({
      myReaction: reaction,
      reactionCounts: reactionsResult.rows[0].reactionCounts,
    });
  });

  return router;
}
