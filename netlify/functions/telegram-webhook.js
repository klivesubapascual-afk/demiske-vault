const { createClient } = require("@supabase/supabase-js");

const TELEGRAM_API = (token, method) =>
  `https://api.telegram.org/bot${token}/${method}`;

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function telegram(method, payload) {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  const res = await fetch(TELEGRAM_API(token, method), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return res.json();
}

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== "POST") {
      return jsonResponse(200, { ok: true });
    }

    const update = JSON.parse(event.body || "{}");

    if (update.message) {
      const chatId = update.message.chat.id;
      const text = update.message.text || "";

      if (text.startsWith("/start")) {
        await telegram("sendMessage", {
          chat_id: chatId,
          text:
            "Welcome to DemiSke Vault Bot ✅\n\n" +
            "This bot is for admin approval only.\n\n" +
            "Customers will receive their account username/password directly on the website after approval.",
        });
      }

      return jsonResponse(200, { ok: true });
    }

    if (!update.callback_query) {
      return jsonResponse(200, { ok: true });
    }

    const callback = update.callback_query;
    const adminId = String(process.env.TELEGRAM_ADMIN_ID);
    const fromId = String(callback.from.id);

    if (fromId !== adminId) {
      await telegram("answerCallbackQuery", {
        callback_query_id: callback.id,
        text: "You are not allowed to approve/deny orders.",
        show_alert: true,
      });

      return jsonResponse(200, { ok: true });
    }

    const [action, orderId] = String(callback.data || "").split(":");

    if (!["approve", "deny"].includes(action) || !orderId) {
      await telegram("answerCallbackQuery", {
        callback_query_id: callback.id,
        text: "Invalid action.",
      });

      return jsonResponse(200, { ok: true });
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const newStatus = action === "approve" ? "approved" : "denied";

    const { data: order, error } = await supabase
      .from("orders")
      .update({ status: newStatus })
      .eq("id", orderId)
      .select()
      .single();

    if (error || !order) {
      await telegram("answerCallbackQuery", {
        callback_query_id: callback.id,
        text: "Order not found or update failed.",
        show_alert: true,
      });

      return jsonResponse(200, { ok: true });
    }

    if (action === "approve") {
      await telegram("answerCallbackQuery", {
        callback_query_id: callback.id,
        text: "Approved. Customer can now see account details on the website.",
      });

      await telegram("editMessageCaption", {
        chat_id: callback.message.chat.id,
        message_id: callback.message.message_id,
        caption:
          `✅ APPROVED\n\n` +
          `Order ID: ${order.id}\n` +
          `Customer Username: ${order.customer_username}\n` +
          `Account: ${order.account_name}\n\n` +
          `Customer can now check the website to see account username/password.`,
        reply_markup: {
          inline_keyboard: [],
        },
      });
    }

    if (action === "deny") {
      await telegram("answerCallbackQuery", {
        callback_query_id: callback.id,
        text: "Denied. Customer will see denied status on the website.",
      });

      await telegram("editMessageCaption", {
        chat_id: callback.message.chat.id,
        message_id: callback.message.message_id,
        caption:
          `❌ DENIED\n\n` +
          `Order ID: ${order.id}\n` +
          `Customer Username: ${order.customer_username}\n` +
          `Account: ${order.account_name}`,
        reply_markup: {
          inline_keyboard: [],
        },
      });
    }

    return jsonResponse(200, { ok: true });
  } catch (error) {
    return jsonResponse(200, {
      ok: false,
      error: error.message,
    });
  }
};
