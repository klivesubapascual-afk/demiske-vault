const { createClient } = require("@supabase/supabase-js");

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

exports.handler = async function (event) {
  try {
    const orderId = event.queryStringParameters?.order_id;
    const customerUsername = event.queryStringParameters?.customer_username;

    if (!orderId || !customerUsername) {
      return jsonResponse(400, { error: "Missing order ID or username." });
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .eq("customer_username", customerUsername)
      .single();

    if (orderError || !order) {
      return jsonResponse(404, { error: "Order not found." });
    }

    if (order.status === "pending") {
      return jsonResponse(200, {
        status: "pending",
        message: "Your payment is still waiting for admin approval.",
      });
    }

    if (order.status === "denied") {
      return jsonResponse(200, {
        status: "denied",
        message: "Your payment proof was denied. Please contact admin.",
      });
    }

    const { data: account, error: accountError } = await supabase
      .from("accounts")
      .select("*")
      .eq("id", order.account_id)
      .single();

    if (accountError || !account) {
      return jsonResponse(404, { error: "Account not found." });
    }

    return jsonResponse(200, {
      status: "approved",
      message: "Payment approved.",
      account: {
        name: account.name,
        level: account.level,
        nickname: account.nickname,
        region: account.region,
        uid: account.uid,
        account_username: account.account_username,
        account_password: account.account_password,
      },
    });
  } catch (error) {
    return jsonResponse(500, { error: error.message });
  }
};
