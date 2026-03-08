import { db } from "./db";
import { projects, projectFiles, aiMessages, buildLogs, deployments } from "@shared/schema";
import { eq } from "drizzle-orm";

export async function seedDatabase() {
  const existing = await db.select().from(projects);
  if (existing.length > 0) return;

  const [p1] = await db.insert(projects).values({
    name: "E-Commerce API",
    description: "Full-stack e-commerce REST API with authentication, product management, shopping cart, and payment processing using Stripe.",
    language: "typescript",
    framework: "express",
    status: "deployed",
    buildStatus: "deployed",
    deployUrl: "https://e-commerce-api.devforge.app",
  }).returning();

  const [p2] = await db.insert(projects).values({
    name: "ML Pipeline Service",
    description: "Machine learning data pipeline with automated training, model versioning, and inference endpoints for real-time predictions.",
    language: "python",
    framework: "fastapi",
    status: "running",
    buildStatus: "tested",
  }).returning();

  const [p3] = await db.insert(projects).values({
    name: "Chat Application",
    description: "Real-time chat application with WebSocket support, message history, file sharing, and end-to-end encryption.",
    language: "typescript",
    framework: "nextjs",
    status: "idle",
    buildStatus: "none",
  }).returning();

  await db.insert(projectFiles).values([
    { projectId: p1.id, name: "package.json", path: "package.json", content: '{\n  "name": "ecommerce-api",\n  "version": "2.1.0",\n  "scripts": {\n    "dev": "tsx watch src/index.ts",\n    "build": "tsc",\n    "test": "jest --coverage"\n  },\n  "dependencies": {\n    "express": "^5.0.0",\n    "stripe": "^14.0.0",\n    "jsonwebtoken": "^9.0.0",\n    "bcryptjs": "^2.4.3"\n  }\n}', type: "file", language: "json" },
    { projectId: p1.id, name: "index.ts", path: "src/index.ts", content: 'import express from "express";\nimport { authRouter } from "./routes/auth";\nimport { productRouter } from "./routes/products";\nimport { cartRouter } from "./routes/cart";\nimport { orderRouter } from "./routes/orders";\n\nconst app = express();\n\napp.use(express.json());\napp.use("/api/auth", authRouter);\napp.use("/api/products", productRouter);\napp.use("/api/cart", cartRouter);\napp.use("/api/orders", orderRouter);\n\napp.listen(3000, () => {\n  console.log("E-Commerce API running on port 3000");\n});', type: "file", language: "typescript" },
    { projectId: p1.id, name: "auth.ts", path: "src/routes/auth.ts", content: 'import { Router } from "express";\nimport jwt from "jsonwebtoken";\nimport bcrypt from "bcryptjs";\n\nexport const authRouter = Router();\n\nauthRouter.post("/register", async (req, res) => {\n  const { email, password } = req.body;\n  const hashed = await bcrypt.hash(password, 10);\n  // Save user to database\n  res.json({ message: "User registered" });\n});\n\nauthRouter.post("/login", async (req, res) => {\n  const { email, password } = req.body;\n  // Validate credentials\n  const token = jwt.sign({ email }, "secret", { expiresIn: "24h" });\n  res.json({ token });\n});', type: "file", language: "typescript" },
    { projectId: p1.id, name: "products.ts", path: "src/routes/products.ts", content: 'import { Router } from "express";\n\nexport const productRouter = Router();\n\nproductRouter.get("/", async (req, res) => {\n  // Fetch all products\n  res.json([]);\n});\n\nproductRouter.get("/:id", async (req, res) => {\n  // Fetch single product\n  res.json({});\n});\n\nproductRouter.post("/", async (req, res) => {\n  // Create product\n  res.status(201).json(req.body);\n});', type: "file", language: "typescript" },
    { projectId: p1.id, name: ".env", path: ".env", content: 'PORT=3000\nDATABASE_URL=postgresql://localhost:5432/ecommerce\nJWT_SECRET=super-secret-key\nSTRIPE_SECRET_KEY=sk_test_xxx', type: "file", language: "plaintext" },
    { projectId: p1.id, name: "README.md", path: "README.md", content: '# E-Commerce API\n\nFull-stack REST API for e-commerce applications.\n\n## Features\n- User authentication (JWT)\n- Product CRUD operations\n- Shopping cart management\n- Order processing with Stripe\n\n## Endpoints\n- POST /api/auth/register\n- POST /api/auth/login\n- GET /api/products\n- POST /api/cart\n- POST /api/orders', type: "file", language: "markdown" },
  ]);

  await db.insert(projectFiles).values([
    { projectId: p2.id, name: "main.py", path: "main.py", content: 'from fastapi import FastAPI\nfrom .pipeline import DataPipeline\nfrom .models import ModelManager\n\napp = FastAPI(title="ML Pipeline Service")\npipeline = DataPipeline()\nmodel_mgr = ModelManager()\n\n@app.get("/")\ndef root():\n    return {"service": "ML Pipeline", "status": "operational"}\n\n@app.post("/train")\nasync def train_model(config: dict):\n    result = await pipeline.run(config)\n    return {"job_id": result.id, "status": "started"}\n\n@app.post("/predict")\nasync def predict(data: dict):\n    prediction = model_mgr.predict(data)\n    return {"prediction": prediction}', type: "file", language: "python" },
    { projectId: p2.id, name: "requirements.txt", path: "requirements.txt", content: 'fastapi==0.104.0\nuvicorn==0.24.0\nscikit-learn==1.3.2\npandas==2.1.3\nnumpy==1.26.2\ntorch==2.1.0', type: "file", language: "plaintext" },
    { projectId: p2.id, name: "pipeline.py", path: "pipeline.py", content: 'import pandas as pd\nfrom sklearn.pipeline import Pipeline\nfrom sklearn.preprocessing import StandardScaler\n\nclass DataPipeline:\n    def __init__(self):\n        self.pipeline = Pipeline([\n            ("scaler", StandardScaler()),\n        ])\n\n    async def run(self, config: dict):\n        # Load and process data\n        # Train model\n        # Save artifacts\n        return {"id": "job-001", "status": "complete"}', type: "file", language: "python" },
  ]);

  await db.insert(projectFiles).values([
    { projectId: p3.id, name: "package.json", path: "package.json", content: '{\n  "name": "chat-app",\n  "version": "0.1.0",\n  "scripts": {\n    "dev": "next dev",\n    "build": "next build"\n  },\n  "dependencies": {\n    "next": "^14.0.0",\n    "react": "^18.0.0",\n    "socket.io-client": "^4.7.0"\n  }\n}', type: "file", language: "json" },
    { projectId: p3.id, name: "page.tsx", path: "src/app/page.tsx", content: 'export default function Home() {\n  return (\n    <main className="flex min-h-screen flex-col items-center p-24">\n      <h1 className="text-4xl font-bold">Chat Application</h1>\n      <p className="mt-4 text-lg text-gray-600">\n        Real-time messaging with WebSocket support\n      </p>\n    </main>\n  );\n}', type: "file", language: "typescript" },
  ]);

  await db.insert(aiMessages).values([
    { projectId: p1.id, role: "user", content: "Create a REST API for an e-commerce platform with auth, products, cart, and orders" },
    { projectId: p1.id, role: "assistant", content: "I've designed a comprehensive e-commerce API architecture:\n\n1. Authentication with JWT tokens and bcrypt password hashing\n2. Product catalog with CRUD operations and search\n3. Shopping cart management with session support\n4. Order processing integrated with Stripe payments\n\nI've generated the project structure with Express.js and TypeScript. The API follows RESTful conventions with proper error handling and validation." },
    { projectId: p2.id, role: "user", content: "Build a machine learning pipeline service" },
    { projectId: p2.id, role: "assistant", content: "I've set up an ML pipeline service with FastAPI:\n\n- Data ingestion and preprocessing pipeline\n- Model training with scikit-learn and PyTorch\n- Model versioning and artifact storage\n- Real-time inference API endpoints\n\nThe service includes automated data validation, feature engineering, and model performance monitoring." },
  ]);

  await db.insert(buildLogs).values([
    { projectId: p1.id, type: "system", message: "Project created with typescript/express", stage: "build" },
    { projectId: p1.id, type: "info", message: "Compiling TypeScript source files...", stage: "build" },
    { projectId: p1.id, type: "success", message: "Build completed successfully in 2.1s", stage: "build" },
    { projectId: p1.id, type: "success", message: "All 18 tests passed in 3.2s", stage: "test" },
    { projectId: p1.id, type: "success", message: "Deployed to https://e-commerce-api.devforge.app", stage: "deploy" },
  ]);

  await db.insert(deployments).values([
    { projectId: p1.id, status: "live", url: "https://e-commerce-api.devforge.app", version: "2.1.0" },
    { projectId: p1.id, status: "archived", url: "https://e-commerce-api.devforge.app", version: "2.0.0" },
    { projectId: p1.id, status: "archived", url: "https://e-commerce-api.devforge.app", version: "1.0.0" },
  ]);

  console.log("Database seeded with sample projects");
}
