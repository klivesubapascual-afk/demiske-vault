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

function base64ToBlob(base64, mimeType) {
  const cleanBase64 = base64.includes(",") ? base64.split(",")[1] : base64;
  const buffer = Buffer.from(cleanBase64, "base64");
  return new Blob([buffer], { type: mimeType || "image/jpeg" });
}

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== "POST") {
      return jsonResponse(405, { error: "Method not allowed" });
    }

    const {
      account_id,
      seller,
      customer_username,
      payment_reference,
      proof_image_base64,
      proof_image_type,
    } = JSON.parse(event.body || "{}");

    if (!account_id || !seller || !customer_username || !payment_reference || !proof_image_base64) {
      return jsonResponse(400, {
        error: "Missing account, seller, username, reference number, or proof screenshot.",
      });
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const adminId = process.env.TELEGRAM_ADMIN_ID;
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!botToken || !adminId || !supabaseUrl || !serviceRoleKey) {
      return jsonResponse(500, { error: "Server environment variables are incomplete." });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: account, error: accountError } = await supabase
      .from("accounts")
      .select("*")
      .eq("id", account_id)
      .single();

    if (accountError || !account) {
      return jsonResponse(404, { error: "Account not found." });
    }

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert({
        account_id: account.id,
        account_name: account.name,
        account_level: account.level,
        account_price: account.price,
        seller,
        customer_username,
        payment_reference,
        status: "pending",
      })
      .select()
      .single();

    if (orderError || !order) {
      return jsonResponse(500, { error: orderError?.message || "Failed to create order." });
    }

    const caption =
      `🧾 <b>New Payment Proof</b>\n\n` +
      `<b>Order ID:</b> ${escapeHtml(order.id)}\n` +
      `<b>Customer Username:</b> ${escapeHtml(customer_username)}\n` +
      `<b>Account:</b> ${escapeHtml(account.name)}\n` +
      `<b>Level:</b> ${escapeHtml(account.level)}\n` +
      `<b>Seller:</b> ${escapeHtml(seller)}\n` +
      `<b>Amount:</b> ₱${escapeHtml(account.price)}\n` +
      `<b>Reference:</b> ${escapeHtml(payment_reference)}\n\n` +
      `Choose an action below:`;

    const formData = new FormData();
    formData.append("chat_id", adminId);
    formData.append("caption", caption);
    formData.append("parse_mode", "HTML");
    formData.append(
      "reply_markup",
      JSON.stringify({
        inline_keyboard: [
          [
            { text: "✅ Approve", callback_data: `approve:${order.id}` },
            { text: "❌ Deny", callback_data: `deny:${order.id}` },
          ],
        ],
      })
    );

    const imageBlob = base64ToBlob(proof_image_base64, proof_image_type || "image/jpeg");
    formData.append("photo", imageBlob, "payment-proof.jpg");

    const tgResponse = await fetch(TELEGRAM_API(botToken, "sendPhoto"), {
      method: "POST",
      body: formData,
    });

    const tgData = await tgResponse.json();

    if (!tgData.ok) {
      return jsonResponse(500, {
        error: "Telegram send failed.",
        details: tgData.description,
      });
    }

    return jsonResponse(200, {
      success: true,
      message: "Payment proof sent to admin for approval.",
      order_id: order.id,
    });
  } catch (error) {
    return jsonResponse(500, { error: error.message || "Unexpected server error." });
  }
};
