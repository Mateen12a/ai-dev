import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const projects = pgTable("projects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  prompt: text("prompt").notNull().default(""),
  language: text("language").notNull().default("typescript"),
  framework: text("framework").notNull().default("express"),
  status: text("status").notNull().default("idle"),
  buildStatus: text("build_status").notNull().default("none"),
  deployUrl: text("deploy_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const projectFiles = pgTable("project_files", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull(),
  path: text("path").notNull(),
  name: text("name").notNull(),
  content: text("content").notNull().default(""),
  type: text("type").notNull().default("file"),
  language: text("language").notNull().default("plaintext"),
});

export const aiMessages = pgTable("ai_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const buildLogs = pgTable("build_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull(),
  type: text("type").notNull().default("info"),
  message: text("message").notNull(),
  stage: text("stage").notNull().default("console"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const deployments = pgTable("deployments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull(),
  status: text("status").notNull().default("pending"),
  url: text("url"),
  version: text("version").notNull().default("1.0.0"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const projectSecrets = pgTable("project_secrets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull(),
  key: text("key").notNull(),
  value: text("value").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const gitCommits = pgTable("git_commits", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull(),
  hash: text("hash").notNull(),
  message: text("message").notNull(),
  files: text("files").notNull().default(""),
  author: text("author").notNull().default("DevForge AI"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).pick({ username: true, password: true });
export const insertProjectSchema = createInsertSchema(projects).omit({ id: true, createdAt: true });
export const insertFileSchema = createInsertSchema(projectFiles).omit({ id: true });
export const insertMessageSchema = createInsertSchema(aiMessages).omit({ id: true, createdAt: true });
export const insertBuildLogSchema = createInsertSchema(buildLogs).omit({ id: true, createdAt: true });
export const insertDeploymentSchema = createInsertSchema(deployments).omit({ id: true, createdAt: true });
export const insertSecretSchema = createInsertSchema(projectSecrets).omit({ id: true, createdAt: true });
export const insertGitCommitSchema = createInsertSchema(gitCommits).omit({ id: true, createdAt: true });

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projects.$inferSelect;
export type InsertFile = z.infer<typeof insertFileSchema>;
export type ProjectFile = typeof projectFiles.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type AIMessage = typeof aiMessages.$inferSelect;
export type InsertBuildLog = z.infer<typeof insertBuildLogSchema>;
export type BuildLog = typeof buildLogs.$inferSelect;
export type InsertDeployment = z.infer<typeof insertDeploymentSchema>;
export type Deployment = typeof deployments.$inferSelect;
export type InsertSecret = z.infer<typeof insertSecretSchema>;
export type ProjectSecret = typeof projectSecrets.$inferSelect;
export type InsertGitCommit = z.infer<typeof insertGitCommitSchema>;
export type GitCommit = typeof gitCommits.$inferSelect;
