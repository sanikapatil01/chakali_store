const express = require("express");
const pool = require("./db");
const bodyParser = require("body-parser");
const session = require("express-session");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const axios = require("axios");

require("dotenv").config();

const app = express();
const ADMIN_WHATSAPP_NUMBER = (
  process.env.ADMIN_WHATSAPP_NUMBER ||
  process.env.WHATSAPP_ADMIN_NUMBER ||
  "919529111760"
).replace(/[^\d]/g, "");
const WA_PHONE_NUMBER_ID = process.env.WA_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_NUMBER_ID || "";
const WA_ACCESS_TOKEN = process.env.WA_ACCESS_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN || "";
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");

app.use((req, res, next) => {
  res.locals.adminWhatsAppNumber = ADMIN_WHATSAPP_NUMBER;
  next();
});

function buildWhatsAppLink(messageText) {
  if (!ADMIN_WHATSAPP_NUMBER) return null;
  return `https://wa.me/${ADMIN_WHATSAPP_NUMBER}?text=${encodeURIComponent(messageText)}`;
}

function normalizeOrderStatus(status) {
  const allowed = ["Order Received", "Packed", "Shipped", "Delivered"];
  if (allowed.includes(status)) return status;
  if (status === "Pending Confirmation" || status === "Processing") return "Order Received";
  return "Order Received";
}

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      price NUMERIC(10,2) DEFAULT 0,
      quantity_grams INTEGER DEFAULT 250,
      stock INTEGER DEFAULT 0,
      cost_price NUMERIC(10,2) DEFAULT 0,
      selling_price NUMERIC(10,2) DEFAULT 0,
      image TEXT,
      description TEXT,
      ingredients TEXT,
      discount_percent NUMERIC(5,2) DEFAULT 0,
      brand_name TEXT,
      offer_text TEXT,
      region_of_origin TEXT,
      net_quantity TEXT,
      items_per_pack INTEGER DEFAULT 1,
      item_part_number TEXT,
      mrp NUMERIC(10,2),
      logo_image TEXT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      customer_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      address TEXT NOT NULL,
      total NUMERIC(10,2) DEFAULT 0,
      payment_status TEXT DEFAULT 'Paid',
      order_status TEXT DEFAULT 'Order Received',
      created_at TIMESTAMP DEFAULT NOW(),
      payment_method TEXT DEFAULT 'online',
      order_source TEXT DEFAULT 'website',
      live_location_url TEXT,
      live_latitude NUMERIC(10,7),
      live_longitude NUMERIC(10,7),
      order_pdf_url TEXT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS order_items (
      id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      unit_price NUMERIC(10,2) DEFAULT 0,
      weight_option TEXT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL
    )
  `);

  await pool.query(`
    INSERT INTO admin (username, password)
    SELECT 'admin', 'admin123'
    WHERE NOT EXISTS (SELECT 1 FROM admin)
  `);

  await pool.query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS description TEXT
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS product_gallery (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      image_path TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS product_reviews (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      customer_name TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      comment TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()
  `);

  await pool.query(`
    ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'online'
  `);

  await pool.query(`
    ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS order_source TEXT DEFAULT 'website'
  `);

  await pool.query(`
    ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS live_location_url TEXT
  `);

  await pool.query(`
    ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS live_latitude NUMERIC(10,7)
  `);

  await pool.query(`
    ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS live_longitude NUMERIC(10,7)
  `);

  await pool.query(`
    ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS order_pdf_url TEXT
  `);

  await pool.query(`
    ALTER TABLE order_items
    ADD COLUMN IF NOT EXISTS unit_price NUMERIC(10,2)
  `);

  await pool.query(`
    ALTER TABLE order_items
    ADD COLUMN IF NOT EXISTS weight_option TEXT
  `);

  await pool.query(`
    ALTER TABLE order_items
    ALTER COLUMN product_id DROP NOT NULL
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'order_items_product_id_fkey'
      ) THEN
        ALTER TABLE order_items DROP CONSTRAINT order_items_product_id_fkey;
      END IF;
    END
    $$;
  `);

  await pool.query(`
    ALTER TABLE order_items
    ADD CONSTRAINT order_items_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS product_weight_prices (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      weight_grams INTEGER NOT NULL CHECK (weight_grams > 0),
      price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
      UNIQUE(product_id, weight_grams)
    )
  `);

  await pool.query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(5,2) DEFAULT 0
  `);
  await pool.query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS brand_name TEXT
  `);
  await pool.query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS offer_text TEXT
  `);
  await pool.query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS region_of_origin TEXT
  `);
  await pool.query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS net_quantity TEXT
  `);
  await pool.query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS items_per_pack INTEGER DEFAULT 1
  `);
  await pool.query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS item_part_number TEXT
  `);
  await pool.query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS mrp NUMERIC(10,2)
  `);
  await pool.query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS logo_image TEXT
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS store_settings (
      id INTEGER PRIMARY KEY,
      delivery_charge NUMERIC(10,2) NOT NULL DEFAULT 40,
      free_delivery_above NUMERIC(10,2),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    INSERT INTO store_settings (id, delivery_charge, free_delivery_above)
    VALUES (1, 40, 499)
    ON CONFLICT (id) DO NOTHING
  `);
}

const WEIGHT_OPTIONS = [100, 250, 500, 750, 1000];

function parseWeightPriceInputs(body) {
  const weightPrices = [];
  for (const grams of WEIGHT_OPTIONS) {
    const raw = body[`weight_price_${grams}`];
    if (raw === undefined || raw === null || raw === "") continue;
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) {
      weightPrices.push({ grams, price: parsed });
    }
  }
  return weightPrices;
}

async function upsertProductWeightPrices(productId, weightPrices) {
  if (!weightPrices || weightPrices.length === 0) return;
  await pool.query("DELETE FROM product_weight_prices WHERE product_id=$1", [productId]);
  for (const item of weightPrices) {
    await pool.query(
      "INSERT INTO product_weight_prices (product_id, weight_grams, price) VALUES ($1,$2,$3)",
      [productId, item.grams, item.price]
    );
  }
}

async function getWeightPricesByProduct(productIds) {
  const map = {};
  if (!productIds || productIds.length === 0) return map;
  const result = await pool.query(
    `SELECT product_id, weight_grams, price
     FROM product_weight_prices
     WHERE product_id = ANY($1::int[])
     ORDER BY weight_grams ASC`,
    [productIds]
  );

  for (const row of result.rows) {
    if (!map[row.product_id]) map[row.product_id] = {};
    map[row.product_id][row.weight_grams] = Number(row.price);
  }
  return map;
}

async function getStoreSettings() {
  const result = await pool.query(
    "SELECT delivery_charge, free_delivery_above FROM store_settings WHERE id=1"
  );
  const row = result.rows[0] || {};
  return {
    deliveryCharge: Number(row.delivery_charge || 0),
    freeDeliveryAbove: row.free_delivery_above !== null && row.free_delivery_above !== undefined
      ? Number(row.free_delivery_above)
      : null
  };
}

function calculatePricing(cartItems, storeSettings) {
  const subtotal = cartItems.reduce((sum, item) => {
    const unit = Number(item.unitPrice || 0);
    const qty = Number(item.quantity || 0);
    const discount = Math.max(0, Math.min(100, Number(item.discountPercent || 0)));
    const discountedUnit = unit * (1 - (discount / 100));
    return sum + (discountedUnit * qty);
  }, 0);

  const deliveryCharge = (storeSettings.freeDeliveryAbove !== null && subtotal >= storeSettings.freeDeliveryAbove)
    ? 0
    : Number(storeSettings.deliveryCharge || 0);
  const total = Math.max(subtotal + deliveryCharge, 0);

  return { subtotal: Math.round(subtotal), deliveryCharge: Math.round(deliveryCharge), total: Math.round(total) };
}

function parseWeightToGrams(weightOption) {
  const match = String(weightOption || "").match(/\d+/);
  if (!match) return null;
  const grams = Number(match[0]);
  return Number.isFinite(grams) && grams > 0 ? grams : null;
}

function pdfEscape(text) {
  return String(text || "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function ensureOrderPdfDir() {
  const orderPdfDir = path.join(__dirname, "public", "order-pdfs");
  if (!fs.existsSync(orderPdfDir)) {
    fs.mkdirSync(orderPdfDir, { recursive: true });
  }
  return orderPdfDir;
}

function buildSimplePdf({ lines, liveLocationUrl }) {
  const x = 42;
  const startY = 800;
  const lineHeight = 14;
  let liveLocationLineIndex = -1;

  const streamParts = [];
  streamParts.push("BT");
  streamParts.push("/F1 11 Tf");
  streamParts.push(`${x} ${startY} Td`);

  lines.forEach((line, index) => {
    if (index > 0) {
      streamParts.push(`0 -${lineHeight} Td`);
    }
    streamParts.push(`(${pdfEscape(line)}) Tj`);
    if (liveLocationUrl && String(line).startsWith("Live Location: ")) {
      liveLocationLineIndex = index;
    }
  });

  streamParts.push("ET");
  const streamText = `${streamParts.join("\n")}\n`;
  const contentLength = Buffer.byteLength(streamText, "utf8");
  const pageAnnots = liveLocationLineIndex >= 0 ? "/Annots [6 0 R]" : "";

  const objects = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push("<< /Type /Pages /Count 1 /Kids [3 0 R] >>");
  objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R ${pageAnnots} >>`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  objects.push(`<< /Length ${contentLength} >>\nstream\n${streamText}endstream`);

  if (liveLocationLineIndex >= 0) {
    const y = startY - (liveLocationLineIndex * lineHeight);
    const escapedUrl = pdfEscape(liveLocationUrl);
    objects.push(
      `<< /Type /Annot /Subtype /Link /Rect [${x} ${y - 2} 560 ${y + 10}] /Border [0 0 0] /A << /S /URI /URI (${escapedUrl}) >> >>`
    );
  }

  let pdf = "%PDF-1.4\n";
  const offsets = [0];

  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const xrefStart = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i <= objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(pdf, "utf8");
}

function createOrderPdfSlip({
  orderId,
  paymentMethod,
  orderSource,
  customerName,
  mobileNumber,
  address,
  liveLocationUrl,
  items,
  subtotal,
  deliveryCharge,
  totalAmount
}) {
  const lines = [
    "New product order via WhatsApp",
    `Order ID: ${orderId}`,
    `Source: ${orderSource}`,
    `Payment: ${paymentMethod === "cod" ? "Cash on Delivery" : "Online"}`,
    ""
  ];

  items.forEach((item, idx) => {
    lines.push(`Item ${idx + 1}`);
    lines.push(`Item Name: ${item.name}`);
    lines.push(`Brand Name: ${item.brandName}`);
    lines.push(`Discount: ${item.discountPercent}%`);
    lines.push(`Price: Rs. ${item.unitPrice}`);
    lines.push(`MRP: Rs. ${item.mrp}`);
    lines.push(`Offer: ${item.offerText}`);
    lines.push(`Weight: ${item.weight}`);
    lines.push(`Number of Items: ${item.itemsPerPack}`);
    lines.push(`Region of Origin: ${item.regionOfOrigin}`);
    lines.push(`Net Quantity: ${item.netQuantity}`);
    lines.push(`Quantity Ordered: ${item.qty}`);
    lines.push("");
  });

  lines.push(`Customer Name: ${customerName}`);
  lines.push(`Mobile Number: ${mobileNumber}`);
  lines.push(`Address: ${address}`);
  lines.push(`Live Location: ${liveLocationUrl || "Not provided"}`);
  lines.push(`Subtotal: Rs. ${Math.round(subtotal)}`);
  lines.push(`Delivery: Rs. ${Math.round(deliveryCharge)}`);
  lines.push(`Total: Rs. ${Math.round(totalAmount)}`);

  const pdfBuffer = buildSimplePdf({ lines, liveLocationUrl: liveLocationUrl || "" });
  const dir = ensureOrderPdfDir();
  const fileName = `order-${orderId}-${Date.now()}.pdf`;
  const fullPath = path.join(dir, fileName);
  fs.writeFileSync(fullPath, pdfBuffer);
  return {
    relativePath: `/order-pdfs/${fileName}`,
    absoluteUrl: `${PUBLIC_BASE_URL}/order-pdfs/${fileName}`
  };
}

async function createOrderFromItems({ items, name, phone, address, paymentMethod, orderSource, liveLocationUrl, liveLatitude, liveLongitude }) {
  const orderedItems = [];
  const enrichedItems = [];
  const storeSettings = await getStoreSettings();

  for (const item of items) {
    const product = await pool.query(
      "SELECT * FROM products WHERE id=$1",
      [item.productId]
    );

    if (product.rows[0]) {
      const row = product.rows[0];
      const selectedWeightGrams = parseWeightToGrams(item.weightOption);
      let baseUnitPrice = null;
      if (selectedWeightGrams) {
        const weightPriceResult = await pool.query(
          "SELECT price FROM product_weight_prices WHERE product_id=$1 AND weight_grams=$2 LIMIT 1",
          [row.id, selectedWeightGrams]
        );
        if (weightPriceResult.rows[0]) {
          baseUnitPrice = Number(weightPriceResult.rows[0].price || 0);
        }
      }
      if (!Number.isFinite(baseUnitPrice) || baseUnitPrice <= 0) {
        baseUnitPrice = Number(row.price || row.selling_price || 0);
      }

      const discountPercent = Math.max(0, Math.min(100, Number(row.discount_percent || 0)));
      const finalUnitPrice = Math.round(baseUnitPrice * (1 - (discountPercent / 100)));
      const quantity = Math.max(1, Math.trunc(Number(item.quantity || 1)));
      const weightLabel = selectedWeightGrams ? `${selectedWeightGrams}g` : (item.weightOption || `${row.quantity_grams || 250}g`);
      const mrpValue = Number(row.mrp || baseUnitPrice);
      const offerText = String(row.offer_text || "").trim() || "No active offer";
      const brandName = row.brand_name || "Chakali Store";
      const itemsPerPack = Math.max(1, Number(row.items_per_pack || 1));
      const regionOfOrigin = row.region_of_origin || "India";
      const netQuantity = row.net_quantity || weightLabel;

      enrichedItems.push({
        productId: row.id,
        quantity,
        unitPrice: finalUnitPrice,
        weightOption: weightLabel
      });
      orderedItems.push({
        name: row.name,
        brandName,
        qty: quantity,
        discountPercent,
        unitPrice: finalUnitPrice,
        mrp: Math.round(mrpValue),
        offerText,
        weight: weightLabel,
        itemsPerPack,
        regionOfOrigin,
        netQuantity
      });
    }
  }

  if (enrichedItems.length === 0) {
    throw new Error("No valid items to order.");
  }

  const subtotal = enrichedItems.reduce((sum, item) => sum + (Number(item.unitPrice) * Number(item.quantity)), 0);
  const deliveryCharge = (storeSettings.freeDeliveryAbove !== null && subtotal >= storeSettings.freeDeliveryAbove)
    ? 0
    : Number(storeSettings.deliveryCharge || 0);
  const totalAmount = Math.max(subtotal + deliveryCharge, 0);

  const itemLines = orderedItems
    .map((item, index) => {
      return (
        `${index + 1}. Item Name: ${item.name}\n` +
        `   Brand Name: ${item.brandName}\n` +
        `   Discount: ${item.discountPercent}%\n` +
        `   Price: Rs. ${item.unitPrice}\n` +
        `   MRP: Rs. ${item.mrp}\n` +
        `   Offer: ${item.offerText}\n` +
        `   Weight: ${item.weight}\n` +
        `   Number of Items: ${item.itemsPerPack}\n` +
        `   Region of Origin: ${item.regionOfOrigin}\n` +
        `   Net Quantity: ${item.netQuantity}\n` +
        `   Quantity Ordered: ${item.qty}`
      );
    })
    .join("\n");

  const orderText =
    `New order received\n` +
    `Source: ${orderSource}\n` +
    `Payment: ${paymentMethod === "cod" ? "Cash on Delivery" : "Online"}\n` +
    `Customer Name: ${name}\n` +
    `Mobile Number: ${phone}\n` +
    `Address: ${address}\n` +
    `Live Location: ${liveLocationUrl || "Not provided"}\n` +
    `Items:\n${itemLines}\n` +
    `Subtotal: Rs. ${Math.round(subtotal)}\n` +
    `Delivery: Rs. ${Math.round(deliveryCharge)}\n` +
    `Total: Rs. ${Math.round(totalAmount)}`;

  const paymentStatus = paymentMethod === "cod" ? "COD Pending" : "Paid";
  const orderStatus = "Order Received";

  const orderResult = await pool.query(
    "INSERT INTO orders (customer_name, phone, address, total, payment_status, order_status, payment_method, order_source, live_location_url, live_latitude, live_longitude) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id",
    [name, phone, address, totalAmount, paymentStatus, orderStatus, paymentMethod, orderSource, liveLocationUrl || null, liveLatitude || null, liveLongitude || null]
  );

  const orderId = orderResult.rows[0].id;
  let orderPdf = null;

  try {
    orderPdf = createOrderPdfSlip({
      orderId,
      paymentMethod,
      orderSource,
      customerName: name,
      mobileNumber: phone,
      address,
      liveLocationUrl,
      items: orderedItems,
      subtotal,
      deliveryCharge,
      totalAmount
    });
    await pool.query(
      "UPDATE orders SET order_pdf_url=$1 WHERE id=$2",
      [orderPdf.absoluteUrl, orderId]
    );
  } catch (pdfErr) {
    console.error("ORDER PDF GENERATION FAILED:", pdfErr);
  }

  for (const item of enrichedItems) {
    await pool.query(
      "UPDATE products SET stock = stock - $1 WHERE id=$2",
      [item.quantity, item.productId]
    );

    await pool.query(
      "INSERT INTO order_items (order_id, product_id, quantity, unit_price, weight_option) VALUES ($1,$2,$3,$4,$5)",
      [orderId, item.productId, item.quantity, item.unitPrice, item.weightOption]
    );
  }

  const notifyResult = await sendAdminWhatsAppNotification({
    messageText: `${orderText}\nOrder ID: ${orderId}\nOrder PDF: ${orderPdf ? orderPdf.absoluteUrl : "Not generated"}`,
    documentUrl: orderPdf ? orderPdf.absoluteUrl : "",
    documentName: `order-${orderId}.pdf`,
    documentCaption: `Order ${orderId} PDF attached`
  });
  return { orderId, notifyResult };
}

async function sendWhatsAppPayload(payload) {
  const requestConfig = {
    headers: {
      Authorization: `Bearer ${WA_ACCESS_TOKEN}`,
      "Content-Type": "application/json"
    }
  };

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await axios.post(
        `https://graph.facebook.com/v21.0/${WA_PHONE_NUMBER_ID}/messages`,
        payload,
        requestConfig
      );
      return { ok: true };
    } catch (err) {
      const details = err.response?.data || err.message;
      console.error(`WhatsApp send failed (attempt ${attempt}):`, details);
      if (attempt === 2) {
        return { ok: false, reason: "api_error", details };
      }
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
  }

  return { ok: false, reason: "api_error", details: "Unknown send error" };
}

async function sendAdminWhatsAppNotification(input) {
  if (!ADMIN_WHATSAPP_NUMBER || !WA_PHONE_NUMBER_ID || !WA_ACCESS_TOKEN) {
    const missing = [];
    if (!ADMIN_WHATSAPP_NUMBER) missing.push("ADMIN_WHATSAPP_NUMBER/WHATSAPP_ADMIN_NUMBER");
    if (!WA_PHONE_NUMBER_ID) missing.push("WA_PHONE_NUMBER_ID/WHATSAPP_PHONE_NUMBER_ID");
    if (!WA_ACCESS_TOKEN) missing.push("WA_ACCESS_TOKEN/WHATSAPP_ACCESS_TOKEN");
    console.log("WhatsApp API credentials are missing:", missing.join(", "));
    return { ok: false, reason: "missing_config", missing };
  }

  const normalized = typeof input === "string"
    ? { messageText: input }
    : (input || {});
  const messageText = String(normalized.messageText || "").trim();
  const documentUrl = String(normalized.documentUrl || "").trim();
  const documentName = String(normalized.documentName || "order.pdf").trim();
  const documentCaption = String(normalized.documentCaption || "Order PDF attached").trim();

  if (documentUrl) {
    const documentPayload = {
      messaging_product: "whatsapp",
      to: ADMIN_WHATSAPP_NUMBER,
      type: "document",
      document: {
        link: documentUrl,
        filename: documentName,
        caption: documentCaption
      }
    };

    const documentResult = await sendWhatsAppPayload(documentPayload);
    if (!documentResult.ok) return documentResult;
  }

  if (messageText) {
    const textPayload = {
      messaging_product: "whatsapp",
      to: ADMIN_WHATSAPP_NUMBER,
      type: "text",
      text: { body: messageText }
    };
    return sendWhatsAppPayload(textPayload);
  }

  return { ok: true };
}

/* ==============================
   MIDDLEWARE
================================= */
app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.urlencoded({ extended: true }));
app.set("view engine", "ejs");
app.use(bodyParser.json());
app.use(session({
  secret: "chakali_secret",
  resave: false,
  saveUninitialized: false
}));

/* ==============================
   ADMIN AUTH MIDDLEWARE
================================= */
function checkAdmin(req, res, next) {
  if (req.session.admin) {
    next();
  } else {
    res.redirect("/admin/login");
  }
}

/* ==============================
   MULTER CONFIG (IMAGE UPLOAD)
================================= */
const uploadPath = path.join(__dirname, "public", "uploads");

if (!fs.existsSync(uploadPath)) {
  fs.mkdirSync(uploadPath, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + "-" + file.originalname);
  }
});

const upload = multer({ storage: storage });
const uploadProductMedia = upload.fields([
  { name: "image", maxCount: 1 },
  { name: "logo_image", maxCount: 1 },
  { name: "gallery_images", maxCount: 8 }
]);

/* ==============================
   HOME PAGE
================================= */
app.get("/", async (req, res) => {
  try {
    const productsResult = await pool.query("SELECT * FROM products ORDER BY id DESC");
    const productIds = productsResult.rows.map((p) => p.id);
    const weightPricesByProduct = await getWeightPricesByProduct(productIds);
    const curatedSlides = [
      { filename: "chakali-slide-1.jpg", alt: "Traditional chakali in blue bowl" },
      { filename: "chakali-slide-2.jpg", alt: "Close-up chakali platter" },
      { filename: "chakali-slide-3.jpg", alt: "Festival style chakali arrangement" },
      { filename: "chakali-slide-4.jpg", alt: "Homemade chakali plate" }
    ];
    const slideshowImages = curatedSlides.map((item) => ({
      src: `/slideshow/${item.filename}`,
      alt: item.alt
    }));

    res.render("index", { 
      products: productsResult.rows,
      slideshowImages,
      weightPricesByProduct,
      weightOptions: WEIGHT_OPTIONS,
      adminWhatsAppNumber: "+91 9529111760" // Replace with your number
    });
  } catch (err) {
    console.error(err);
    res.send("Database error");
  }
});
app.get("/shop", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM products ORDER BY id DESC");
    const productIds = result.rows.map((p) => p.id);
    const weightPricesByProduct = await getWeightPricesByProduct(productIds);
    res.render("shop", { products: result.rows, weightPricesByProduct, weightOptions: WEIGHT_OPTIONS });
  } catch (err) {
    console.error(err);
    res.status(500).send("Database Error");
  }
});

/* ==============================
   PRODUCT PAGE
================================= */
app.get("/product/:id", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM products WHERE id=$1",
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).send("Product not found");
    }

    const product = result.rows[0];
    const productPrice = product.price || product.selling_price || 0;
    const galleryResult = await pool.query(
      "SELECT image_path FROM product_gallery WHERE product_id=$1 ORDER BY id DESC",
      [req.params.id]
    );
    const reviewsResult = await pool.query(
      "SELECT customer_name, rating, comment, created_at FROM product_reviews WHERE product_id=$1 ORDER BY id DESC",
      [req.params.id]
    );
    const ratingResult = await pool.query(
      "SELECT COALESCE(ROUND(AVG(rating)::numeric,1),0) as avg_rating, COUNT(*) as total_reviews FROM product_reviews WHERE product_id=$1",
      [req.params.id]
    );
    const whatsappText =
      `New order enquiry from website\n` +
      `Product: ${product.name}\n` +
      `Qty: 1\n` +
      `Price: Rs. ${productPrice}`;

    const weightPricesResult = await pool.query(
      "SELECT weight_grams, price FROM product_weight_prices WHERE product_id=$1 ORDER BY weight_grams ASC",
      [req.params.id]
    );

    res.render("product", {
      product,
      galleryImages: galleryResult.rows.map((row) => row.image_path),
      reviews: reviewsResult.rows,
      ratingSummary: ratingResult.rows[0],
      weightPrices: weightPricesResult.rows.map((row) => ({ grams: row.weight_grams, price: Number(row.price) })),
      weightOptions: WEIGHT_OPTIONS,
      adminWhatsAppLink: buildWhatsAppLink(whatsappText)
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Database Error");
  }
});

/* ==============================
   CART SYSTEM
================================= */
app.post("/add-to-cart", async (req, res) => {
  const { productId, quantity, unitPrice, weightOption } = req.body;
  const parsedProductId = parseInt(productId, 10);
  const parsedQuantity = parseInt(quantity, 10);
  const parsedUnitPrice = unitPrice ? Number(unitPrice) : null;

  if (!parsedProductId || !parsedQuantity || parsedQuantity < 1) {
    return res.status(400).send("Invalid cart item");
  }

  if (!req.session.cart) {
    req.session.cart = [];
  }

  req.session.cart.push({
    productId: parsedProductId,
    quantity: parsedQuantity,
    unitPrice: parsedUnitPrice,
    weightOption: weightOption || "250g"
  });

  res.redirect("/cart");
});

app.post("/buy-now", async (req, res) => {
  const { productId, quantity, unitPrice, weightOption } = req.body;
  req.session.cart = [{
    productId: parseInt(productId, 10),
    quantity: parseInt(quantity, 10) || 1,
    unitPrice: unitPrice ? Number(unitPrice) : null,
    weightOption: weightOption || "250g"
  }];
  res.redirect("/cart");
});

app.get("/cart", async (req, res) => {
  try {
    if (!req.session.cart) req.session.cart = [];

    const storeSettings = await getStoreSettings();
    const cartDetails = [];

    for (const item of req.session.cart) {
      const product = await pool.query(
        "SELECT * FROM products WHERE id=$1",
        [item.productId]
      );

      if (product.rows[0]) {
        const fallbackPrice = Number(product.rows[0].price || product.rows[0].selling_price || 0);
        const effectivePrice = Number(item.unitPrice || fallbackPrice);
        cartDetails.push({
          product: product.rows[0],
          quantity: item.quantity,
          unitPrice: effectivePrice,
          discountPercent: Number(product.rows[0].discount_percent || 0),
          weightOption: item.weightOption || "250g"
        });
      }
    }

    const pricing = calculatePricing(
      cartDetails.map((item) => ({
        productId: item.product.id,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discountPercent: item.discountPercent
      })),
      storeSettings
    );
    res.render("cart", { cart: cartDetails, pricing, adminWhatsAppNumber: ADMIN_WHATSAPP_NUMBER, storeSettings });
  } catch (err) {
    console.error(err);
    res.status(500).send("Database Error");
  }
});

/* ==============================
   PLACE ORDER (STOCK REDUCE)
================================= */
app.post("/place-order", async (req, res) => {
  try {
    const { name, phone, address } = req.body;
    const paymentMethod = req.body.payment_method === "cod" ? "cod" : "online";
    const orderSource = req.body.order_source === "whatsapp" ? "whatsapp" : "website";
    const liveLocationUrl = String(req.body.live_location_url || "").trim();
    const liveLatitude = req.body.live_latitude ? Number(req.body.live_latitude) : null;
    const liveLongitude = req.body.live_longitude ? Number(req.body.live_longitude) : null;

    if (!req.session.cart || req.session.cart.length === 0) {
      return res.send("Cart is empty");
    }

    const { orderId, notifyResult } = await createOrderFromItems({
      items: req.session.cart,
      name,
      phone,
      address,
      paymentMethod,
      orderSource,
      liveLocationUrl,
      liveLatitude,
      liveLongitude
    });
    req.session.cart = [];

    if (notifyResult.ok) {
      return res.redirect(`/order-success/${orderId}`);
    }

    if (notifyResult.reason === "missing_config") {
      return res.redirect(`/order-success/${orderId}?notify=missing_config`);
    }

    return res.redirect(`/order-success/${orderId}?notify=failed`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Order failed");
  }
});

app.post("/place-single-order", async (req, res) => {
  try {
    const { productId, quantity, unitPrice, weightOption, name, phone, address } = req.body;
    const paymentMethod = req.body.payment_method === "cod" ? "cod" : "online";
    const orderSource = req.body.order_source === "whatsapp" ? "whatsapp" : "website";
    const liveLocationUrl = String(req.body.live_location_url || "").trim();
    const liveLatitude = req.body.live_latitude ? Number(req.body.live_latitude) : null;
    const liveLongitude = req.body.live_longitude ? Number(req.body.live_longitude) : null;

    const { orderId, notifyResult } = await createOrderFromItems({
      items: [{
        productId: Number(productId),
        quantity: Number(quantity || 1),
        unitPrice: Number(unitPrice || 0),
        weightOption: weightOption || "250g"
      }],
      name,
      phone,
      address,
      paymentMethod,
      orderSource,
      liveLocationUrl,
      liveLatitude,
      liveLongitude
    });

    if (notifyResult.ok) {
      return res.redirect(`/order-success/${orderId}`);
    }

    if (notifyResult.reason === "missing_config") {
      return res.redirect(`/order-success/${orderId}?notify=missing_config`);
    }

    return res.redirect(`/order-success/${orderId}?notify=failed`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Single order failed");
  }
});

app.post("/product/:id/review", async (req, res) => {
  try {
    const { customer_name, rating, comment } = req.body;
    const safeRating = Math.max(1, Math.min(5, Number(rating || 5)));
    await pool.query(
      "INSERT INTO product_reviews (product_id, customer_name, rating, comment) VALUES ($1,$2,$3,$4)",
      [req.params.id, customer_name || "Customer", safeRating, comment || ""]
    );
    res.redirect(`/product/${req.params.id}`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Review failed");
  }
});

app.get("/order-success/:id", async (req, res) => {
  try {
    const order = await pool.query("SELECT * FROM orders WHERE id=$1", [req.params.id]);
    if (!order.rows[0]) return res.status(404).send("Order not found");
    res.render("order-success", { order: order.rows[0], notify: req.query.notify || "" });
  } catch (err) {
    console.error(err);
    res.status(500).send("Order lookup failed");
  }
});

app.get("/order-tracking", async (req, res) => {
  try {
    const orderId = req.query.orderId;
    let order = null;
    let orderItems = [];
    if (orderId) {
      const result = await pool.query("SELECT * FROM orders WHERE id=$1", [orderId]);
      order = result.rows[0] || null;
      if (order) {
        order.order_status = normalizeOrderStatus(order.order_status);
        const itemsResult = await pool.query(
          `SELECT
             oi.quantity,
             oi.unit_price,
             oi.weight_option,
             COALESCE(p.name, 'Deleted Product') AS product_name,
             p.image AS product_image,
             COALESCE(oi.unit_price, p.price, p.selling_price, 0) AS effective_unit_price
           FROM order_items oi
           LEFT JOIN products p ON p.id = oi.product_id
           WHERE oi.order_id=$1
           ORDER BY oi.id ASC`,
          [orderId]
        );
        orderItems = itemsResult.rows.map((row) => {
          const unitPrice = Number(row.effective_unit_price || 0);
          const qty = Number(row.quantity || 0);
          return {
            ...row,
            unit_price: unitPrice,
            line_total: Math.round(unitPrice * qty)
          };
        });
      }
    }
    res.render("order-tracking", { order, orderItems });
  } catch (err) {
    console.error(err);
    res.status(500).send("Tracking failed");
  }
});

/* ==============================
   ADMIN LOGIN
================================= */
app.get("/admin/login", (req, res) => {
  res.render("admin/login");
});

app.post("/admin/login", async (req, res) => {
  const { username, password } = req.body;

  const result = await pool.query(
    "SELECT * FROM admin WHERE username=$1 AND password=$2",
    [username, password]
  );

  if (result.rows.length > 0) {
    req.session.admin = username;
    res.redirect("/admin/dashboard");
  } else {
    res.send("Invalid Credentials");
  }
});

/* ==============================
   ADMIN DASHBOARD + ANALYTICS
================================= */
app.get("/admin/dashboard", checkAdmin, async (req, res) => {
  try {
    const products = await pool.query("SELECT * FROM products ORDER BY id DESC");
    const orders = await pool.query("SELECT * FROM orders ORDER BY id DESC LIMIT 30");
    const todayOrders = await pool.query(
      "SELECT * FROM orders WHERE DATE(created_at)=CURRENT_DATE ORDER BY id DESC LIMIT 30"
    );

    const totalSales = await pool.query(
      "SELECT COALESCE(SUM(total),0) as total FROM orders WHERE payment_status='Paid'"
    );

    const totalOrders = await pool.query("SELECT COUNT(*) FROM orders");

    const bestSelling = await pool.query(`
      SELECT p.name, SUM(oi.quantity) as total_sold
      FROM order_items oi
      JOIN products p ON p.id = oi.product_id
      GROUP BY p.name
      ORDER BY total_sold DESC
      LIMIT 1
    `);

    const totalProfit = await pool.query(`
      SELECT COALESCE(SUM((p.selling_price - p.cost_price) * oi.quantity),0) as profit
      FROM order_items oi
      JOIN products p ON p.id = oi.product_id
    `);

    const orderStats = await pool.query(`
      SELECT
        COUNT(*) AS total_orders,
        COUNT(*) FILTER (WHERE order_status IN ('Order Received', 'Packed')) AS pending_orders,
        COUNT(*) FILTER (WHERE order_status = 'Shipped') AS current_orders,
        COUNT(*) FILTER (WHERE order_status = 'Delivered') AS completed_orders
      FROM orders
    `);

    const dailySales = await pool.query(`
      SELECT DATE(created_at) AS day, COALESCE(SUM(total),0) AS sales
      FROM orders
      WHERE created_at >= NOW() - INTERVAL '14 days'
      GROUP BY DATE(created_at)
      ORDER BY day ASC
    `);

    const dailyProfit = await pool.query(`
      SELECT DATE(o.created_at) AS day,
             COALESCE(SUM((COALESCE(p.selling_price, p.price, 0) - COALESCE(p.cost_price, 0)) * oi.quantity),0) AS profit
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE o.created_at >= NOW() - INTERVAL '14 days'
      GROUP BY DATE(o.created_at)
      ORDER BY day ASC
    `);

    const productsWithWeights = products.rows;
    const productIds = productsWithWeights.map((p) => p.id);
    const weightPricesByProduct = await getWeightPricesByProduct(productIds);
    const storeSettings = await getStoreSettings();

    const dailyMap = new Map();
    for (const row of dailySales.rows) {
      const key = new Date(row.day).toISOString().slice(0, 10);
      dailyMap.set(key, { day: key, sales: Number(row.sales), profit: 0 });
    }
    for (const row of dailyProfit.rows) {
      const key = new Date(row.day).toISOString().slice(0, 10);
      const existing = dailyMap.get(key) || { day: key, sales: 0, profit: 0 };
      existing.profit = Number(row.profit);
      dailyMap.set(key, existing);
    }
    const dailyChartData = Array.from(dailyMap.values()).sort((a, b) => a.day.localeCompare(b.day));

    const missingWhatsAppConfig = [];
    if (!ADMIN_WHATSAPP_NUMBER) missingWhatsAppConfig.push("ADMIN_WHATSAPP_NUMBER");
    if (!WA_PHONE_NUMBER_ID) missingWhatsAppConfig.push("WA_PHONE_NUMBER_ID");
    if (!WA_ACCESS_TOKEN) missingWhatsAppConfig.push("WA_ACCESS_TOKEN");

    res.render("admin/dashboard", {
      products: products.rows,
      orders: orders.rows.map((o) => ({ ...o, order_status: normalizeOrderStatus(o.order_status) })),
      todayOrders: todayOrders.rows.map((o) => ({ ...o, order_status: normalizeOrderStatus(o.order_status) })),
      totalSales: totalSales.rows[0].total,
      totalOrders: totalOrders.rows[0].count,
      bestSelling: bestSelling.rows[0],
      totalProfit: totalProfit.rows[0].profit,
      orderStats: orderStats.rows[0],
      dailyChartData,
      weightOptions: WEIGHT_OPTIONS,
      weightPricesByProduct,
      storeSettings,
      whatsAppStatus: {
        configured: missingWhatsAppConfig.length === 0,
        number: ADMIN_WHATSAPP_NUMBER,
        missing: missingWhatsAppConfig
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Dashboard failed");
  }
});

app.post("/admin/update-order-status/:id", checkAdmin, async (req, res) => {
  try {
    const status = normalizeOrderStatus(req.body.order_status);
    await pool.query("UPDATE orders SET order_status=$1 WHERE id=$2", [status, req.params.id]);
    res.redirect("/admin/dashboard");
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to update order status");
  }
});

app.post(["/admin/settings/delivery", "/admin/settings/delivery/"], checkAdmin, async (req, res) => {
  try {
    const charge = Number(req.body.delivery_charge || 0);
    const rawFree = req.body.free_delivery_above;
    const freeAbove = rawFree === "" ? null : Number(rawFree);

    if (!Number.isFinite(charge) || charge < 0) {
      return res.status(400).send("Invalid delivery charge.");
    }
    if (freeAbove !== null && (!Number.isFinite(freeAbove) || freeAbove < 0)) {
      return res.status(400).send("Invalid free-delivery threshold.");
    }

    await pool.query(
      `UPDATE store_settings
       SET delivery_charge=$1, free_delivery_above=$2, updated_at=NOW()
       WHERE id=1`,
      [charge, freeAbove]
    );
    res.redirect("/admin/dashboard");
  } catch (err) {
    console.error("DELIVERY SETTINGS ERROR:", err);
    res.status(500).send("Failed to update delivery settings.");
  }
});

app.post(["/admin/product-discount/:id", "/admin/product-discount/:id/"], checkAdmin, async (req, res) => {
  try {
    const productId = Number(req.params.id);
    const action = req.body.action || "apply";
    let discount = Number(req.body.discount_percent || 0);
    if (!Number.isFinite(discount) || discount < 0) discount = 0;
    if (discount > 95) discount = 95;
    if (action === "remove") discount = 0;

    await pool.query("UPDATE products SET discount_percent=$1 WHERE id=$2", [discount, productId]);
    res.redirect("/admin/dashboard#products");
  } catch (err) {
    console.error("DISCOUNT ERROR:", err);
    res.status(500).send("Failed to update product discount.");
  }
});

app.post("/admin/product-discount", checkAdmin, async (req, res) => {
  try {
    const productId = Number(req.body.product_id || 0);
    const action = req.body.action || "apply";
    let discount = Number(req.body.discount_percent || 0);
    if (!productId) return res.status(400).send("Product id is required.");
    if (!Number.isFinite(discount) || discount < 0) discount = 0;
    if (discount > 95) discount = 95;
    if (action === "remove") discount = 0;

    await pool.query("UPDATE products SET discount_percent=$1 WHERE id=$2", [discount, productId]);
    res.redirect("/admin/dashboard#products");
  } catch (err) {
    console.error("DISCOUNT ERROR:", err);
    res.status(500).send("Failed to update product discount.");
  }
});

/* ==============================
   ADD PRODUCT
================================= */
app.get("/admin/add-product", checkAdmin, (req, res) => {
  res.render("admin/add-product");
});

app.post("/admin/add-product", checkAdmin, uploadProductMedia, async (req, res) => {
  try {
    const {
      name,
      description,
      ingredients,
      quantity_grams,
      stock,
      cost_price,
      selling_price,
      category,
      price,
      brand_name,
      offer_text,
      region_of_origin,
      net_quantity,
      items_per_pack,
      item_part_number,
      mrp
    } = req.body;
    const weightPrices = parseWeightPriceInputs(req.body);

    let image = null;
    let logoImage = null;
    if (req.files && req.files.image && req.files.image[0]) {
      image = req.files.image[0].filename;
    }
    if (req.files && req.files.logo_image && req.files.logo_image[0]) {
      logoImage = req.files.logo_image[0].filename;
    }

    if (!name || !category) {
      return res.status(400).send("Product name and category are required.");
    }
    if (weightPrices.length === 0) {
      return res.status(400).send("Please add at least one gram-wise price.");
    }

    const mapFromWeights = {};
    for (const item of weightPrices) mapFromWeights[item.grams] = Number(item.price);
    const fallbackSelling = mapFromWeights[250] || mapFromWeights[500] || mapFromWeights[100] || mapFromWeights[750] || mapFromWeights[1000] || 0;
    const finalSellingPrice = Number(selling_price || price || fallbackSelling || 0);
    const finalPrice = finalSellingPrice;
    const finalQuantityGrams = Number(quantity_grams || 250);
    const finalStock = Number(stock || 0);
    const finalCostPrice = Number(cost_price || 0);
    const finalBrandName = String(brand_name || "").trim();
    const finalOfferText = String(offer_text || "").trim();
    const finalOrigin = String(region_of_origin || "").trim();
    const finalNetQuantity = String(net_quantity || "").trim();
    const finalItemPartNumber = String(item_part_number || "").trim();
    const finalItemsPerPack = Number(items_per_pack || 1);
    const finalMrp = mrp === undefined || mrp === null || mrp === "" ? null : Number(mrp);

    if (!Number.isFinite(finalSellingPrice) || finalSellingPrice <= 0) {
      return res.status(400).send("Invalid gram-wise prices. Selling price could not be calculated.");
    }
    if (!Number.isFinite(finalQuantityGrams) || finalQuantityGrams <= 0) {
      return res.status(400).send("Invalid quantity value.");
    }
    if (!Number.isFinite(finalStock) || finalStock < 0) {
      return res.status(400).send("Invalid stock value.");
    }
    if (!Number.isFinite(finalCostPrice) || finalCostPrice < 0) {
      return res.status(400).send("Invalid cost price value.");
    }
    if (!Number.isFinite(finalItemsPerPack) || finalItemsPerPack < 1) {
      return res.status(400).send("Invalid number of items value.");
    }
    if (finalMrp !== null && (!Number.isFinite(finalMrp) || finalMrp < 0)) {
      return res.status(400).send("Invalid MRP value.");
    }

    const insertResult = await pool.query(
      `INSERT INTO products
      (name, description, ingredients, quantity_grams, stock, cost_price, selling_price, category, image, price, brand_name, offer_text, region_of_origin, net_quantity, items_per_pack, item_part_number, mrp, logo_image)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
      [
        name,
        description,
        ingredients,
        finalQuantityGrams,
        finalStock,
        finalCostPrice,
        finalSellingPrice,
        category,
        image,
        finalPrice,
        finalBrandName || null,
        finalOfferText || null,
        finalOrigin || null,
        finalNetQuantity || null,
        Math.trunc(finalItemsPerPack),
        finalItemPartNumber || null,
        finalMrp,
        logoImage
      ]
    );

    const productId = insertResult.rows[0].id;
    await upsertProductWeightPrices(productId, weightPrices);
    const galleryFiles = req.files && req.files.gallery_images ? req.files.gallery_images : [];
    for (const file of galleryFiles) {
      await pool.query(
        "INSERT INTO product_gallery (product_id, image_path) VALUES ($1,$2)",
        [productId, file.filename]
      );
    }

    res.redirect("/admin/dashboard");
  } catch (err) {
    console.error("INSERT ERROR:", err);
    res.status(500).send("Error adding product: " + (err.message || "Unknown error"));
  }
});

/* ==============================
   UPDATE PRODUCT
================================= */
app.post("/admin/update-product/:id", checkAdmin, uploadProductMedia, async (req, res) => {
  try {
    const {
      name,
      description,
      ingredients,
      quantity_grams,
      stock,
      cost_price,
      selling_price,
      category,
      price,
      brand_name,
      offer_text,
      region_of_origin,
      net_quantity,
      items_per_pack,
      item_part_number,
      mrp
    } = req.body;
    const productId = req.params.id;
    const weightPrices = parseWeightPriceInputs(req.body);
    const existingProductResult = await pool.query("SELECT * FROM products WHERE id=$1", [productId]);
    const existingProduct = existingProductResult.rows[0] || {};
    const mapFromWeights = {};
    for (const item of weightPrices) mapFromWeights[item.grams] = Number(item.price);
    const fallbackSelling = mapFromWeights[250] || mapFromWeights[500] || mapFromWeights[100] || mapFromWeights[750] || mapFromWeights[1000] || 0;
    const finalSellingPrice = Number(selling_price || price || fallbackSelling || existingProduct.selling_price || existingProduct.price || 0);
    const finalPrice = finalSellingPrice;
    const finalQuantityGrams = Number(quantity_grams || existingProduct.quantity_grams || 250);
    const finalStock = Number(stock || existingProduct.stock || 0);
    const finalCostPrice = Number(cost_price || existingProduct.cost_price || 0);
    const finalBrandName = String(brand_name || "").trim();
    const finalOfferText = String(offer_text || "").trim();
    const finalOrigin = String(region_of_origin || "").trim();
    const finalNetQuantity = String(net_quantity || "").trim();
    const finalItemPartNumber = String(item_part_number || "").trim();
    const finalItemsPerPack = Number(items_per_pack || existingProduct.items_per_pack || 1);
    const finalMrp = mrp === undefined || mrp === null || mrp === ""
      ? (existingProduct.mrp === null || existingProduct.mrp === undefined ? null : Number(existingProduct.mrp))
      : Number(mrp);
    const finalImage = (req.files && req.files.image && req.files.image[0])
      ? req.files.image[0].filename
      : existingProduct.image;
    const finalLogoImage = (req.files && req.files.logo_image && req.files.logo_image[0])
      ? req.files.logo_image[0].filename
      : existingProduct.logo_image;

    if (!name || !category) {
      return res.status(400).send("Product name and category are required.");
    }
    if (!Number.isFinite(finalSellingPrice) || finalSellingPrice <= 0) {
      return res.status(400).send("Invalid gram-wise prices. Selling price could not be calculated.");
    }
    if (!Number.isFinite(finalQuantityGrams) || finalQuantityGrams <= 0) {
      return res.status(400).send("Invalid quantity value.");
    }
    if (!Number.isFinite(finalStock) || finalStock < 0) {
      return res.status(400).send("Invalid stock value.");
    }
    if (!Number.isFinite(finalCostPrice) || finalCostPrice < 0) {
      return res.status(400).send("Invalid cost price value.");
    }
    if (!Number.isFinite(finalItemsPerPack) || finalItemsPerPack < 1) {
      return res.status(400).send("Invalid number of items value.");
    }
    if (finalMrp !== null && (!Number.isFinite(finalMrp) || finalMrp < 0)) {
      return res.status(400).send("Invalid MRP value.");
    }

    await pool.query(
      `UPDATE products
       SET name=$1, description=$2, ingredients=$3, quantity_grams=$4, stock=$5, cost_price=$6, selling_price=$7, category=$8, price=$9, image=$10, brand_name=$11, offer_text=$12, region_of_origin=$13, net_quantity=$14, items_per_pack=$15, item_part_number=$16, mrp=$17, logo_image=$18
       WHERE id=$19`,
      [
        name,
        description,
        ingredients,
        finalQuantityGrams,
        finalStock,
        finalCostPrice,
        finalSellingPrice,
        category,
        finalPrice,
        finalImage,
        finalBrandName || null,
        finalOfferText || null,
        finalOrigin || null,
        finalNetQuantity || null,
        Math.trunc(finalItemsPerPack),
        finalItemPartNumber || null,
        finalMrp,
        finalLogoImage || null,
        productId
      ]
    );

    const galleryFiles = req.files && req.files.gallery_images ? req.files.gallery_images : [];
    for (const file of galleryFiles) {
      await pool.query(
        "INSERT INTO product_gallery (product_id, image_path) VALUES ($1,$2)",
        [productId, file.filename]
      );
    }

    await upsertProductWeightPrices(productId, weightPrices);

    res.redirect("/admin/dashboard");
  } catch (err) {
    console.error("UPDATE ERROR:", err);
    res.status(500).send("Error updating product: " + (err.message || "Unknown error"));
  }
});

/* ==============================
   DELETE PRODUCT
================================= */
app.get("/admin/delete/:id", checkAdmin, async (req, res) => {
  try {
    await pool.query("DELETE FROM products WHERE id=$1", [req.params.id]);
    res.redirect("/admin/dashboard");
  } catch (err) {
    console.error("DELETE PRODUCT ERROR:", err);
    res.status(500).send("Failed to delete product");
  }
});

/* ==============================
   SERVER START
================================= */
initializeDatabase()
  .then(() => {
    const PORT = Number(process.env.PORT || 3000);
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server started at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Database init failed:", err);
    process.exit(1);
  });
