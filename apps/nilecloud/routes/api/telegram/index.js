import crypto from "crypto";
/** Session Schema */
const sessionSchema = {
  type: "string",
  pattern: "^[a-z0-9]{16}$",
};

/** Phone Schema */
const phoneSchema = {
  type: "string",
  pattern: "^\\+?[1-9]\\d{7,14}$",
};

/**
 * @param {import("fastify").FastifyInstance} fastify
 * @param {object} opts
 */
export default async function (fastify, opts) {
  fastify
    // Login with Phone
    .post(
      "/login",
      {
        schema: {
          body: {
            type: "object",
            required: ["phone"],
            properties: {
              phone: phoneSchema,
            },
          },
        },
      },
      async function (request, reply) {
        /** Generate Session ID */
        const session = crypto.randomBytes(8).toString("hex");

        /** Create Client */
        const client = await fastify.lib.GramClient.create(session);

        /** Start Pending */
        await client.startPending();

        /** Send Phone Number */
        const result = await client.startResponse("phone", request.body.phone);

        /** Return Response */
        return { ...result, session };
      },
    )

    // Verify Code
    .post(
      "/code",
      {
        schema: {
          body: {
            type: "object",
            required: ["session", "code"],
            properties: {
              session: sessionSchema,
              code: { type: "string" },
            },
          },
        },
      },
      async function (request, reply) {
        /** Create Client */
        const client = await fastify.lib.GramClient.create(
          request.body.session,
        );

        /** Send Phone Code */
        const result = await client.startResponse("code", request.body.code);

        if (result.user) {
          const account = await fastify.db.Account.findWithActiveSubscription(
            Number(result.user.id),
          );

          if (account) {
            await account.update({
              session: request.body.session,
            });
          } else {
            await client.logout();
            return reply.forbidden("Not allowed!");
          }
        }

        return result;
      },
    )

    // Verify 2FA Password
    .post(
      "/password",
      {
        schema: {
          body: {
            type: "object",
            required: ["session", "password"],
            properties: {
              session: sessionSchema,
              password: { type: "string" },
            },
          },
        },
      },
      async function (request, reply) {
        /** Create Client */
        const client = await fastify.lib.GramClient.create(
          request.body.session,
        );

        /** Send Password */
        const result = await client.startResponse(
          "password",
          request.body.password,
        );

        if (result.user) {
          const account = await fastify.db.Account.findWithActiveSubscription(
            Number(result.user.id),
          );

          if (account) {
            await account.update({
              session: request.body.session,
            });
          } else {
            await client.logout();
            return reply.forbidden("Not allowed!");
          }
        }

        return result;
      },
    )

    // Logout
    .post(
      "/logout",
      {
        schema: {
          body: {
            type: "object",
            required: ["auth"],
            properties: {
              auth: { type: "string" },
            },
          },
        },
        preHandler: [fastify.validateWebAppData],
      },
      async function (request, reply) {
        const { user } = request.auth;
        const account = await fastify.db.Account.findWithActiveSubscription(
          Number(user.id),
          false,
        );

        if (account?.session) {
          /** Best-effort Telegram logout — don't let a broken session block the clear */
          try {
            const client = await fastify.lib.GramClient.create(account.session);
            await Promise.race([
              client.connect().then(() => client.logout()),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error("timeout")), 5000),
              ),
            ]);
          } catch (error) {
            if (process.env.NODE_ENV === "development") {
              console.error("Error logging out account:", error);
            }
          }
        }

        /** Always clear session — even if Telegram logout failed */
        if (account) {
          await account.update({ session: null });
        }

        return {
          result: true,
        };
      },
    );
}
