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
      return jsonResponse(400, {
        error: "Missing order ID or username.",
      });
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
      return jsonResponse(404, {
        error: "Order not found.",
      });
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

    if (order.status === "approved") {
      return jsonResponse(200, {
        status: "approved",
        message: "Payment approved.",
        account: {
          name: order.delivered_account_name,
          level: order.delivered_account_level,
          nickname: order.delivered_nickname,
          region: order.delivered_region,
          uid: order.delivered_uid,
          account_username: order.delivered_account_username,
          account_password: order.delivered_account_password,
        },
      });
    }

    return jsonResponse(200, {
      status: order.status || "unknown",
      message: "Unknown order status.",
    });
  } catch (error) {
    return jsonResponse(500, {
      error: error.message,
    });
  }
};
