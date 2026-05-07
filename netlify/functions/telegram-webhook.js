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
            "This bot is for admin approval.\n\n" +
            "Customers will see account username/password directly on the website after approval.",
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

    const { data: existingOrder, error: findOrderError } = await supabase
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .single();

    if (findOrderError || !existingOrder) {
      await telegram("answerCallbackQuery", {
        callback_query_id: callback.id,
        text: "Order not found.",
        show_alert: true,
      });

      return jsonResponse(200, { ok: true });
    }

    let order = existingOrder;

    if (action === "approve") {
      const { data: account, error: accountError } = await supabase
        .from("accounts")
        .select("*")
        .eq("id", existingOrder.account_id)
        .single();

      if (accountError || !account) {
        await telegram("answerCallbackQuery", {
          callback_query_id: callback.id,
          text: "Account not found. It may already be deleted.",
          show_alert: true,
        });

        return jsonResponse(200, { ok: true });
      }

      const { data: updatedOrder, error: updateError } = await supabase
        .from("orders")
        .update({
          status: "approved",
          delivered_account_name: account.name,
          delivered_account_level: account.level,
          delivered_nickname: account.nickname,
          delivered_region: account.region,
          delivered_uid: account.uid,
          delivered_account_username: account.account_username,
          delivered_account_password: account.account_password,
        })
        .eq("id", orderId)
        .select()
        .single();

      if (updateError || !updatedOrder) {
        await telegram("answerCallbackQuery", {
          callback_query_id: callback.id,
          text: "Failed to approve order.",
          show_alert: true,
        });

        return jsonResponse(200, { ok: true });
      }

      order = updatedOrder;

      await supabase
        .from("accounts")
        .delete()
        .eq("id", existingOrder.account_id);

      await telegram("answerCallbackQuery", {
        callback_query_id: callback.id,
        text: "Approved. Account removed from shop. Customer can check website.",
      });

      await telegram("editMessageCaption", {
        chat_id: callback.message.chat.id,
        message_id: callback.message.message_id,
        caption:
          `✅ APPROVED\n\n` +
          `Order ID: ${order.id}\n` +
          `Customer Username: ${order.customer_username}\n` +
          `Account: ${order.delivered_account_name || order.account_name}\n\n` +
          `Account has been removed from available shop list.\n` +
          `Customer can now check the website to see username/password.`,
        reply_markup: {
          inline_keyboard: [],
        },
      });
    }

    if (action === "deny") {
      const { data: updatedOrder, error: updateError } = await supabase
        .from("orders")
        .update({ status: "denied" })
        .eq("id", orderId)
        .select()
        .single();

      if (updateError || !updatedOrder) {
        await telegram("answerCallbackQuery", {
          callback_query_id: callback.id,
          text: "Failed to deny order.",
          show_alert: true,
        });

        return jsonResponse(200, { ok: true });
      }

      order = updatedOrder;

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
