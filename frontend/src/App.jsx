
import { useEffect, useRef, useState } from "react";
import "./App.css";

const API_URL = `http://${window.location.hostname}:5000`;
const SCAN_DURATION = 2500;

const CATEGORIES = [
  "Food",
  "Groceries",
  "Utilities",
  "Transport",
  "Shopping",
  "Healthcare",
  "Entertainment",
  "Education",
  "Other",
];

const CURRENCIES = ["INR", "USD", "EUR", "GBP"];

const REQUIRED_FIELDS = [
  "merchant",
  "date",
  "totalAmount",
  "currency",
  "category",
];

// -------------------- IndexedDB --------------------

function createBillId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `bill-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`;
}

const DB_NAME = "BillSnapDB";
const STORE_NAME = "bills";

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, {
          keyPath: "id",
        });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveBillToDatabase(bill) {
  const database = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");

    transaction.objectStore(STORE_NAME).put(bill);

    transaction.oncomplete = () => {
      database.close();
      resolve();
    };

    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
  });
}

async function getBillsFromDatabase() {
  const database = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).getAll();

    request.onsuccess = () => {
      database.close();
      resolve(request.result);
    };

    request.onerror = () => {
      database.close();
      reject(request.error);
    };
  });
}

async function deleteBillFromDatabase(id) {
  const database = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");

    transaction.objectStore(STORE_NAME).delete(id);

    transaction.oncomplete = () => {
      database.close();
      resolve();
    };

    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
  });
}

// -------------------- Main App --------------------

function App() {
  const cameraRef = useRef(null);
  const galleryRef = useRef(null);

  const [currentPage, setCurrentPage] = useState("home");

  const [image, setImage] = useState(null);
  const [preview, setPreview] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [savedBills, setSavedBills] = useState([]);

  const [draft, setDraft] = useState({
    merchant: "",
    date: "",
    totalAmount: "",
    currency: "INR",
    category: "Other",
  });

  const [editedFields, setEditedFields] = useState([]);

  useEffect(() => {
    loadSavedBills();
  }, []);

  useEffect(() => {
    return () => {
      if (preview) {
        URL.revokeObjectURL(preview);
      }
    };
  }, [preview]);

  async function loadSavedBills() {
    try {
      const bills = await getBillsFromDatabase();

      bills.sort(
        (a, b) =>
          new Date(b.savedAt).getTime() -
          new Date(a.savedAt).getTime()
      );

      setSavedBills(bills);
    } catch (err) {
      console.error("Unable to load saved bills:", err);
      setError("Unable to load your saved bills.");
    }
  }

  // -------------------- Image Selection --------------------

  function handleImageSelection(event) {
    const selectedFile = event.target.files?.[0];

    if (!selectedFile) return;

    setError("");
    setSuccess("");
    setResult(null);
    setEditedFields([]);

    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
    ];

    if (!allowedTypes.includes(selectedFile.type)) {
      setError("Please select a JPG, PNG, or WEBP image.");
      event.target.value = "";
      return;
    }

    if (selectedFile.size > 8 * 1024 * 1024) {
      setError("Image size must be less than 8 MB.");
      event.target.value = "";
      return;
    }

    setImage(selectedFile);
    setPreview(URL.createObjectURL(selectedFile));

    setDraft({
      merchant: "",
      date: "",
      totalAmount: "",
      currency: "INR",
      category: "Other",
    });

    event.target.value = "";
  }

  // -------------------- Bill Scanning --------------------

  async function handleScanBill() {
    if (!image) {
      setError("Please select a bill image first.");
      return;
    }

    const scanStartedAt = Date.now();

    setLoading(true);
    setError("");
    setSuccess("");
    setResult(null);
    setEditedFields([]);

    try {
      const formData = new FormData();
      formData.append("image", image);

      const response = await fetch(`${API_URL}/api/analyze`, {
        method: "POST",
        body: formData,
      });

      const responseData = await response.json();

      if (!response.ok || responseData.success === false) {
        throw new Error(
          responseData.message ||
          responseData.error ||
          "Unable to analyze this image."
        );
      }

      const aiResult = responseData.data || responseData;

      console.log("Frontend received AI result:", aiResult);

      const elapsedTime = Date.now() - scanStartedAt;
      const remainingTime = Math.max(
        0,
        SCAN_DURATION - elapsedTime
      );

      if (remainingTime > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, remainingTime)
        );
      }

      setResult(aiResult);

      if (aiResult.isBill === true) {
        setDraft({
          merchant: aiResult.merchant ?? "",
          date: aiResult.date ?? "",
          totalAmount:
            aiResult.totalAmount === null ||
            aiResult.totalAmount === undefined
              ? ""
              : String(aiResult.totalAmount),
          currency: aiResult.currency || "INR",
          category: aiResult.category || "Other",
        });
      }
    } catch (err) {
      console.error("Bill scanning error:", err);

      setError(
        err.message ||
        "Something went wrong while analyzing the bill."
      );
    } finally {
      setLoading(false);
    }
  }

  // -------------------- Review Helpers --------------------

  function isFieldNeedsReview(field) {
    const isEmpty =
      draft[field] === null ||
      draft[field] === undefined ||
      String(draft[field]).trim() === "";

    const flaggedByAI =
      result?.uncertainFields?.includes(field) &&
      !editedFields.includes(field);

    return isEmpty || flaggedByAI;
  }

  function getReviewCount() {
    return REQUIRED_FIELDS.filter((field) =>
      isFieldNeedsReview(field)
    ).length;
  }

  function updateDraft(field, value) {
    setDraft((previous) => ({
      ...previous,
      [field]: value,
    }));

    setEditedFields((previous) =>
      previous.includes(field)
        ? previous
        : [...previous, field]
    );
  }

  function renderFieldStatus(field) {
    if (editedFields.includes(field)) {
      return (
        <span className="field-status corrected">
          ✓ Edited by you
        </span>
      );
    }

    if (isFieldNeedsReview(field)) {
      return (
        <span className="field-status warning">
          ⚠ Needs review
        </span>
      );
    }

    return (
      <span className="field-status clear">
        ✓ AI result clear
      </span>
    );
  }

  // -------------------- Save Bill --------------------

  async function handleSaveBill() {
    if (!image || !result?.isBill) {
      setError("Please scan a bill before saving.");
      return;
    }

    if (getReviewCount() > 0) {
      setError("Please review all highlighted fields before saving.");
      return;
    }

    const amount = Number(draft.totalAmount);

    if (!Number.isFinite(amount) || amount < 0) {
      setError("Please enter a valid total amount.");
      return;
    }

    if (!CURRENCIES.includes(draft.currency)) {
      setError("Please select a valid currency.");
      return;
    }

    if (!CATEGORIES.includes(draft.category)) {
      setError("Please select a valid category.");
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const bill = {
        id: createBillId(),
        merchant: draft.merchant.trim(),
        date: draft.date,
        totalAmount: amount,
        currency: draft.currency,
        category: draft.category,
        image,
        savedAt: new Date().toISOString(),
      };

      await saveBillToDatabase(bill);
      await loadSavedBills();

      setSuccess("Your bill has been saved successfully!");
    } catch (err) {
      console.error("Bill saving error:", err);
      setError("Unable to save this bill. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  // -------------------- Delete Bill --------------------

  async function handleDeleteBill(id) {
    const confirmed = window.confirm(
      "Are you sure you want to delete this bill?"
    );

    if (!confirmed) return;

    try {
      await deleteBillFromDatabase(id);
      await loadSavedBills();
      setSuccess("Bill deleted successfully.");
      setError("");
    } catch (err) {
      console.error("Bill deletion error:", err);
      setError("Unable to delete this bill.");
    }
  }

  // -------------------- Reset --------------------

  function resetScan() {
    setImage(null);
    setPreview("");
    setResult(null);
    setError("");
    setSuccess("");
    setEditedFields([]);

    setDraft({
      merchant: "",
      date: "",
      totalAmount: "",
      currency: "INR",
      category: "Other",
    });
  }

  // -------------------- Welcome Page --------------------

  if (currentPage === "home") {
    return (
      <div className="welcome-page">
        <nav className="welcome-nav">
          <div className="brand-area">
            <div className="logo">B</div>

            <div>
              <div className="brand">Bill Snap</div>
              <div className="tagline">Smart bill management</div>
            </div>
          </div>

          <button
            className="btn btn-secondary welcome-nav-button"
            onClick={() => setCurrentPage("scanner")}
            type="button"
          >
            Open Scanner
          </button>
        </nav>

        <main className="welcome-content">
          <div className="welcome-badge">
            ✦ AI-POWERED BILL ORGANIZER
          </div>

          <h1 className="welcome-title">
            Your bills,
            <span> beautifully organized.</span>
          </h1>

          <p className="welcome-description">
            Say goodbye to scattered paper receipts.
            Scan, organize and manage your bills effortlessly
            with the power of AI.
          </p>

          <button
            className="btn btn-primary welcome-start-button"
            onClick={() => setCurrentPage("scanner")}
            type="button"
          >
            Get Started <span>→</span>
          </button>

          <div className="welcome-visual">
            <div className="floating-receipt receipt-back">
              <span>YOUR RECEIPT</span>
              <div className="receipt-line long"></div>
              <div className="receipt-line"></div>
              <div className="receipt-line short"></div>
              <div className="receipt-total"></div>
            </div>

            <div className="floating-receipt receipt-front">
              <div className="receipt-check">✓</div>
              <h3>Bill scanned!</h3>
              <p>Your receipt is ready</p>
              <div className="receipt-line long"></div>
              <div className="receipt-line"></div>
              <div className="receipt-line short"></div>
              <div className="receipt-saved">✓ Saved successfully</div>
            </div>

            <div className="visual-sparkle sparkle-one">✦</div>
            <div className="visual-sparkle sparkle-two">✧</div>
            <div className="visual-sparkle sparkle-three">✦</div>
          </div>

          <div className="welcome-features">
            <div className="welcome-feature">
              <span className="feature-icon">📸</span>
              <h3>Snap</h3>
              <p>Capture or upload your bill.</p>
            </div>

            <div className="welcome-feature">
              <span className="feature-icon">✦</span>
              <h3>Scan</h3>
              <p>Let AI extract the details.</p>
            </div>

            <div className="welcome-feature">
              <span className="feature-icon">✓</span>
              <h3>Save</h3>
              <p>Keep your bills organized.</p>
            </div>
          </div>

          <div className="welcome-note">
            <span>🔒</span>
            Your saved bills stay on this device.
          </div>
        </main>

        <footer className="welcome-footer">
          Bill Snap · Simple. Smart. Organized.
        </footer>
      </div>
    );
  }

  // -------------------- Scanner Page --------------------

  return (
    <div className="app">
      <div className="container">

        <header className="header">
          <div className="brand-area">
            <div className="logo">B</div>

            <div>
              <div className="brand">Bill Snap</div>
              <div className="tagline">
                Smart bill management
              </div>
            </div>
          </div>

          <button
            className="btn btn-secondary home-button"
            onClick={() => setCurrentPage("home")}
            type="button"
          >
            ← Home
          </button>
        </header>

        <section className="hero">
          <div className="hero-label">
            ✦ AI-POWERED BILL ORGANIZER
          </div>

          <h1>
            Every bill, <span>beautifully organized.</span>
          </h1>

          <p>
            Capture, understand, and organize your bills in seconds.
            Your records stay on this device.
          </p>
        </section>

        <main className="panel">

          <section className="upload-section">
            <h2>Upload your bill</h2>

            <p className="section-description">
              Take a photo or choose an image from your gallery.
            </p>

            <div className="upload-area">
              <div className="upload-icon">↑</div>

              <h3>
                {image ? "Image selected" : "Choose a bill image"}
              </h3>

              <p>
                {image
                  ? image.name
                  : "JPG, PNG or WEBP · Maximum 8 MB"}
              </p>

              <div className="actions">
                <button
                  className="btn btn-primary"
                  onClick={() => cameraRef.current?.click()}
                  type="button"
                >
                  Take a photo
                </button>

                <button
                  className="btn btn-secondary"
                  onClick={() => galleryRef.current?.click()}
                  type="button"
                >
                  Choose from gallery
                </button>
              </div>

              <input
                ref={cameraRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                hidden
                onChange={handleImageSelection}
              />

              <input
                ref={galleryRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                hidden
                onChange={handleImageSelection}
              />
            </div>
          </section>

          {preview && (
            <section className="preview-section">
              <h3>Selected image</h3>

              <div className="preview">
                <div
                  className={`image-scan-frame ${
                    loading ? "scanning" : ""
                  }`}
                >
                  <img
                    src={preview}
                    alt="Selected bill preview"
                  />
                </div>
              </div>

              <button
                className="btn reset-button"
                onClick={resetScan}
                type="button"
                disabled={loading}
              >
                Remove image
              </button>
            </section>
          )}

          {image && !result && (
            <button
              className="btn btn-primary scan-button"
              onClick={handleScanBill}
              disabled={loading}
              type="button"
            >
              {loading ? "Analyzing your image..." : "✦ Scan bill with AI"}
            </button>
          )}

          {loading && (
            <div className="loading-message">
              <div className="loader"></div>

              <p>✦ AI is examining your bill...</p>

              <div className="scan-progress">
                <span></span>
              </div>

              <p className="scan-caption">
                Extracting merchant, date, amount and category.
              </p>
            </div>
          )}

          {error && (
            <div className="error" role="alert">
              ⚠ {error}
            </div>
          )}

          {success && (
            <div className="success-message" role="status">
              ✓ {success}
            </div>
          )}

          {result && (
            <section className="result">

              {result.isBill === true ? (
                <>
                  <div className="result-heading">
                    <div>
                      <span className="result-icon">✓</span>
                    </div>

                    <div>
                      <h2>Review your bill</h2>
                      <p>
                        Bill detected! Verify the extracted details
                        before saving.
                      </p>
                    </div>
                  </div>

                  {getReviewCount() > 0 ? (
                    <div className="review-summary">
                      ⚠ {getReviewCount()} field(s) need review.
                      Please check the highlighted fields.
                    </div>
                  ) : (
                    <div className="review-summary success">
                      ✓ No missing or AI-flagged fields remain.
                      Please verify all extracted details before saving.
                    </div>
                  )}

                  <div className="field-list">

                    <div className="field">
                      <div className="field-heading">
                        <label htmlFor="merchant">Merchant name</label>
                        {renderFieldStatus("merchant")}
                      </div>

                      <input
                        id="merchant"
                        type="text"
                        value={draft.merchant}
                        onChange={(e) =>
                          updateDraft("merchant", e.target.value)
                        }
                        placeholder="Enter merchant name"
                      />

                      {isFieldNeedsReview("merchant") && (
                        <p className="field-hint">
                          Please check or enter the merchant name.
                        </p>
                      )}
                    </div>

                    <div className="field">
                      <div className="field-heading">
                        <label htmlFor="date">Bill date</label>
                        {renderFieldStatus("date")}
                      </div>

                      <input
                        id="date"
                        type="date"
                        value={draft.date}
                        onChange={(e) =>
                          updateDraft("date", e.target.value)
                        }
                      />

                      {isFieldNeedsReview("date") && (
                        <p className="field-hint">
                          Please check or enter the bill date.
                        </p>
                      )}
                    </div>

                    <div className="field">
                      <div className="field-heading">
                        <label htmlFor="amount">Total amount</label>
                        {renderFieldStatus("totalAmount")}
                      </div>

                      <input
                        id="amount"
                        type="number"
                        min="0"
                        step="0.01"
                        value={draft.totalAmount}
                        onChange={(e) =>
                          updateDraft("totalAmount", e.target.value)
                        }
                        placeholder="Enter total amount"
                      />

                      {isFieldNeedsReview("totalAmount") && (
                        <p className="field-hint">
                          Please check or enter the total amount.
                        </p>
                      )}
                    </div>

                    <div className="field">
                      <div className="field-heading">
                        <label htmlFor="currency">Currency</label>
                        {renderFieldStatus("currency")}
                      </div>

                      <select
                        id="currency"
                        value={draft.currency}
                        onChange={(e) =>
                          updateDraft("currency", e.target.value)
                        }
                      >
                        {CURRENCIES.map((currency) => (
                          <option key={currency} value={currency}>
                            {currency}
                          </option>
                        ))}
                      </select>

                      {isFieldNeedsReview("currency") && (
                        <p className="field-hint">
                          Please verify the currency.
                        </p>
                      )}
                    </div>

                    <div className="field">
                      <div className="field-heading">
                        <label htmlFor="category">Category</label>
                        {renderFieldStatus("category")}
                      </div>

                      <select
                        id="category"
                        value={draft.category}
                        onChange={(e) =>
                          updateDraft("category", e.target.value)
                        }
                      >
                        {CATEGORIES.map((category) => (
                          <option key={category} value={category}>
                            {category}
                          </option>
                        ))}
                      </select>

                      {isFieldNeedsReview("category") && (
                        <p className="field-hint">
                          Please verify the suggested category.
                        </p>
                      )}
                    </div>

                  </div>

                  {result.notes && (
                    <p className="ai-note">
                      AI note: {result.notes}
                    </p>
                  )}

                  <div className="result-actions">
                    <button
                      className="btn btn-primary save-button"
                      onClick={handleSaveBill}
                      disabled={saving || getReviewCount() > 0}
                      type="button"
                    >
                      {saving ? "Saving..." : "Save bill"}
                    </button>

                    <button
                      className="btn reset-button"
                      onClick={resetScan}
                      disabled={saving}
                      type="button"
                    >
                      Scan another
                    </button>
                  </div>
                </>
              ) : (
                <div className="rejected">
                  <div className="rejected-icon">!</div>

                  <h2>This image doesn't appear to be a bill</h2>

                  <p>
                    {result.rejectionReason ||
                      "Please upload a purchase bill, receipt, or invoice."}
                  </p>

                  {result.notes && <p>{result.notes}</p>}

                  <button
                    className="btn btn-primary"
                    onClick={resetScan}
                    type="button"
                  >
                    Try another image
                  </button>
                </div>
              )}

            </section>
          )}

        </main>

        <section className="saved-section">
          <div className="saved-heading">
            <div>
              <h2>Your saved bills</h2>
              <p>
                Your bills are stored locally on this device.
              </p>
            </div>

            <span className="bill-count">
              {savedBills.length} saved
            </span>
          </div>

          {savedBills.length === 0 ? (
            <div className="saved-empty">
              <div className="empty-icon">▤</div>
              <h3>No bills saved yet</h3>
              <p>
                Your saved bills will appear here after scanning.
              </p>
            </div>
          ) : (
            <div className="bill-list">
              {savedBills.map((bill) => (
                <article className="bill-card" key={bill.id}>
                  <div className="bill-top">
                    <div className="bill-name">
                      <h3>{bill.merchant}</h3>
                      <span>{bill.category}</span>
                    </div>

                    <div className="bill-amount">
                      {bill.currency}{" "}
                      {Number(bill.totalAmount).toFixed(2)}
                    </div>
                  </div>

                  <div className="bill-details">
                    <span>📅 {bill.date}</span>
                    <span>
                      Saved{" "}
                      {new Date(bill.savedAt).toLocaleDateString()}
                    </span>
                  </div>

                  <button
                    className="delete-button"
                    onClick={() => handleDeleteBill(bill.id)}
                    type="button"
                  >
                    Delete
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>

        <footer className="footer">
          <p>Bill Snap · Simple. Smart. Organized.</p>
          <span>Made with care</span>
        </footer>

      </div>
    </div>
  );
}

export default App;
