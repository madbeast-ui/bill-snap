
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const Groq = require("groq-sdk");
const multer = require("multer");

const app = express();
const PORT = 5000;

// Initialize Groq
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// Configure image uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Please upload a JPG, PNG, or WEBP image."));
    }
  },
});

// Middleware
app.use(
  cors({
     origin: [
    "http://localhost:5173",
    "http://localhost:4173",
    "http://192.168.29.35:4173"
  ]
  })
);

app.use(express.json());

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Bill Snap backend is running!",
  });
});

// AI configuration check
app.get("/api/ai-status", (req, res) => {
  res.json({
    success: Boolean(process.env.GROQ_API_KEY),
    message: process.env.GROQ_API_KEY
      ? "Groq API key is configured."
      : "Groq API key is missing.",
  });
});

// Analyze uploaded bill
app.post("/api/analyze", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Please upload an image.",
      });
    }

    const base64Image = req.file.buffer.toString("base64");

    const imageData = `data:${req.file.mimetype};base64,${base64Image}`;

    const prompt = `
You are an AI bill-scanning assistant.

Examine the uploaded image carefully.

First determine whether it is a genuine purchase bill,
receipt, invoice, or utility bill.

Do not classify selfies, identity cards, screenshots,
academic documents, or random photographs as bills.

If it is not a bill, return this JSON structure:

{
  "isBill": false,
  "rejectionReason": "Brief polite explanation",
  "merchant": null,
  "date": null,
  "totalAmount": null,
  "currency": null,
  "category": null,
  "uncertainFields": [],
  "notes": "Image is not a bill"
}

If it is a bill, extract only information visible in the image.

Never invent or guess missing information.

Mark a field as uncertain if:
- Its value is missing.
- Its text is blurry or unreadable.
- You cannot confidently identify the correct value.
- Multiple possible values appear and you cannot determine
  which one is correct.

Return ONLY a valid JSON object in this structure:

{
  "isBill": true,
  "rejectionReason": null,
  "merchant": "Merchant name or null",
  "date": "Date in YYYY-MM-DD format or null",
  "totalAmount": 0,
  "currency": "Currency code or null",
  "category": "Food | Groceries | Utilities | Shopping | Travel | Healthcare | Entertainment | Other | null",
  "uncertainFields": [],
  "notes": "Explain unclear or missing information"
}

The uncertainFields array can contain only these names:

"merchant", "date", "totalAmount", "currency", "category"

For example, if the date is unreadable and the total amount
is unclear, return:

"uncertainFields": ["date", "totalAmount"]

For totalAmount, return a number without currency symbols.
Use the final payable total, not subtotal or tax.
If you cannot identify it confidently, return null.

For category, suggest the most suitable category based on
the merchant and bill contents. Use Other if appropriate.
Do not mark a reasonable category suggestion as uncertain
unless the bill does not provide enough information.
`;

    const completion = await groq.chat.completions.create({
      model: "qwen/qwen3.8-27b",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: prompt,
            },
            {
              type: "image_url",
              image_url: {
                url: imageData,
              },
            },
          ],
        },
      ],
      response_format: {
        type: "json_object",
      },
      temperature: 0,
      max_completion_tokens: 800,
    });

    const aiResponse = completion.choices[0].message.content;

    console.log("\n========== GROQ AI RESPONSE ==========");
    console.log(aiResponse);

    const result = JSON.parse(aiResponse);

    console.log("========== PARSED RESULT =============");
    console.log(result);
    console.log("======================================\n");
    // Ensure non-bill responses have a consistent structure
    if (!result.isBill) {
      result.uncertainFields = [];

      return res.json({
        success: true,
        data: result,
      });
    }

    // Validate uncertain fields returned by AI
    const allowedFields = [
      "merchant",
      "date",
      "totalAmount",
      "currency",
      "category",
    ];

    const uncertainFields = Array.isArray(result.uncertainFields)
      ? result.uncertainFields.filter((field) =>
          allowedFields.includes(field)
        )
      : [];

    // Automatically flag missing or empty values
    allowedFields.forEach((field) => {
      const value = result[field];

      if (
        value === null ||
        value === undefined ||
        value === ""
      ) {
        if (!uncertainFields.includes(field)) {
          uncertainFields.push(field);
        }
      }
    });

    result.uncertainFields = uncertainFields;

    return res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Bill analysis error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to analyze this image. Please try again.",
    });
  }
});

// Handle upload errors
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    return res.status(400).json({
      success: false,
      message:
        error.code === "LIMIT_FILE_SIZE"
          ? "Image must be smaller than 8 MB."
          : error.message,
    });
  }

  if (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }

  next();
});

// Start server
app.listen(PORT, () => {
  console.log(`Backend running at http://localhost:${PORT}`);
});
