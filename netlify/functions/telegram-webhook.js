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

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    if (update.message) {
      const chatId = update.message.chat.id;
      const text = update.message.text || "";

      if (text.startsWith("/start")) {
        await telegram("sendMessage", {
          chat_id: chatId,
          text:
            "Welcome to DemiSke Vault Bot ✅\n\n" +
            "Your Telegram ID is:\n" +
            `${chatId}\n\n` +
            "Copy this number and paste it on the website when submitting payment proof.",
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

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      await telegram("answerCallbackQuery", {
        callback_query_id: callback.id,
        text: "Order not found.",
        show_alert: true,
      });

      return jsonResponse(200, { ok: true });
    }

    const { data: account, error: accountError } = await supabase
      .from("accounts")
      .select("*")
      .eq("id", order.account_id)
      .single();

    if (accountError || !account) {
      await telegram("answerCallbackQuery", {
        callback_query_id: callback.id,
        text: "Account not found.",
        show_alert: true,
      });

      return jsonResponse(200, { ok: true });
    }

    if (action === "approve") {
      await supabase
        .from("orders")
        .update({ status: "approved" })
        .eq("id", orderId);

      const customerMessage =
        `✅ <b>Payment Approved!</b>\n\n` +
        `<b>Account:</b> ${escapeHtml(account.name)}\n` +
        `<b>Level:</b> ${escapeHtml(account.level)}\n` +
        `<b>Nickname:</b> ${escapeHtml(account.nickname || "N/A")}\n` +
        `<b>Region:</b> ${escapeHtml(account.region || "N/A")}\n` +
        `<b>UID:</b> ${escapeHtml(account.uid || "N/A")}\n\n` +
        `<b>Account Username:</b> ${escapeHtml(account.account_username || "Not set")}\n` +
        `<b>Account Password:</b> ${escapeHtml(account.account_password || "Not set")}\n\n` +
        `Thank you for buying from DemiSke Vault.`;

      await telegram("sendMessage", {
        chat_id: order.customer_telegram_id,
        text: customerMessage,
        parse_mode: "HTML",
      });

      await telegram("answerCallbackQuery", {
        callback_query_id: callback.id,
        text: "Approved. Account details sent to customer.",
      });

      await telegram("editMessageCaption", {
        chat_id: callback.message.chat.id,
        message_id: callback.message.message_id,
        caption:
          `✅ APPROVED\n\n` +
          `Order ID: ${order.id}\n` +
          `Account: ${order.account_name}\n` +
          `Customer Telegram ID: ${order.customer_telegram_id}`,
        reply_markup: {
          inline_keyboard: [],
        },
      });
    }

    if (action === "deny") {
      await supabase
        .from("orders")
        .update({ status: "denied" })
        .eq("id", orderId);

      await telegram("sendMessage", {
        chat_id: order.customer_telegram_id,
        text:
          "❌ Payment denied.\n\n" +
          "Your payment proof was not approved. Please contact admin or resend a valid proof.",
      });

      await telegram("answerCallbackQuery", {
        callback_query_id: callback.id,
        text: "Denied. Customer has been notified.",
      });

      await telegram("editMessageCaption", {
        chat_id: callback.message.chat.id,
        message_id: callback.message.message_id,
        caption:
          `❌ DENIED\n\n` +
          `Order ID: ${order.id}\n` +
          `Account: ${order.account_name}\n` +
          `Customer Telegram ID: ${order.customer_telegram_id}`,
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
