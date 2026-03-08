import {
  type Project, type InsertProject,
  type ProjectFile, type InsertFile,
  type AIMessage, type InsertMessage,
  type BuildLog, type InsertBuildLog,
  type Deployment, type InsertDeployment,
  type ProjectSecret, type InsertSecret,
  type GitCommit, type InsertGitCommit,
  projects, projectFiles, aiMessages, buildLogs, deployments, projectSecrets, gitCommits,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc } from "drizzle-orm";

export interface IStorage {
  getProjects(): Promise<Project[]>;
  getProject(id: string): Promise<Project | undefined>;
  createProject(project: InsertProject): Promise<Project>;
  updateProject(id: string, data: Partial<any>): Promise<Project | undefined>;
  deleteProject(id: string): Promise<void>;

  getFiles(projectId: string): Promise<ProjectFile[]>;
  getFile(id: string): Promise<ProjectFile | undefined>;
  createFile(file: InsertFile): Promise<ProjectFile>;
  updateFile(id: string, content: string): Promise<ProjectFile | undefined>;
  renameFile(id: string, name: string, path: string): Promise<ProjectFile | undefined>;
  deleteFile(id: string): Promise<void>;

  getMessages(projectId: string): Promise<AIMessage[]>;
  createMessage(message: InsertMessage): Promise<AIMessage>;
  clearMessages(projectId: string): Promise<void>;

  getLogs(projectId: string): Promise<BuildLog[]>;
  createLog(log: InsertBuildLog): Promise<BuildLog>;
  clearLogs(projectId: string): Promise<void>;

  getDeployments(projectId: string): Promise<Deployment[]>;
  createDeployment(deployment: InsertDeployment): Promise<Deployment>;
  updateDeployment(id: string, data: Partial<any>): Promise<Deployment | undefined>;

  getSecrets(projectId: string): Promise<ProjectSecret[]>;
  createSecret(secret: InsertSecret): Promise<ProjectSecret>;
  updateSecret(id: string, value: string): Promise<ProjectSecret | undefined>;
  deleteSecret(id: string): Promise<void>;

  getGitCommits(projectId: string): Promise<GitCommit[]>;
  createGitCommit(commit: InsertGitCommit): Promise<GitCommit>;
}

export class DatabaseStorage implements IStorage {
  async getProjects(): Promise<Project[]> {
    return db.select().from(projects).orderBy(desc(projects.createdAt));
  }

  async getProject(id: string): Promise<Project | undefined> {
    const [p] = await db.select().from(projects).where(eq(projects.id, id));
    return p;
  }

  async createProject(data: InsertProject): Promise<Project> {
    const [p] = await db.insert(projects).values(data).returning();
    return p;
  }

  async updateProject(id: string, data: Partial<any>): Promise<Project | undefined> {
    const [p] = await db.update(projects).set(data).where(eq(projects.id, id)).returning();
    return p;
  }

  async deleteProject(id: string): Promise<void> {
    await db.delete(buildLogs).where(eq(buildLogs.projectId, id));
    await db.delete(aiMessages).where(eq(aiMessages.projectId, id));
    await db.delete(deployments).where(eq(deployments.projectId, id));
    await db.delete(projectSecrets).where(eq(projectSecrets.projectId, id));
    await db.delete(gitCommits).where(eq(gitCommits.projectId, id));
    await db.delete(projectFiles).where(eq(projectFiles.projectId, id));
    await db.delete(projects).where(eq(projects.id, id));
  }

  async getFiles(projectId: string): Promise<ProjectFile[]> {
    return db.select().from(projectFiles).where(eq(projectFiles.projectId, projectId));
  }

  async getFile(id: string): Promise<ProjectFile | undefined> {
    const [f] = await db.select().from(projectFiles).where(eq(projectFiles.id, id));
    return f;
  }

  async createFile(data: InsertFile): Promise<ProjectFile> {
    const [f] = await db.insert(projectFiles).values(data).returning();
    return f;
  }

  async updateFile(id: string, content: string): Promise<ProjectFile | undefined> {
    const [f] = await db.update(projectFiles).set({ content }).where(eq(projectFiles.id, id)).returning();
    return f;
  }

  async renameFile(id: string, name: string, path: string): Promise<ProjectFile | undefined> {
    const [f] = await db.update(projectFiles).set({ name, path }).where(eq(projectFiles.id, id)).returning();
    return f;
  }

  async deleteFile(id: string): Promise<void> {
    await db.delete(projectFiles).where(eq(projectFiles.id, id));
  }

  async getMessages(projectId: string): Promise<AIMessage[]> {
    return db.select().from(aiMessages).where(eq(aiMessages.projectId, projectId)).orderBy(aiMessages.createdAt);
  }

  async createMessage(data: InsertMessage): Promise<AIMessage> {
    const [m] = await db.insert(aiMessages).values(data).returning();
    return m;
  }

  async clearMessages(projectId: string): Promise<void> {
    await db.delete(aiMessages).where(eq(aiMessages.projectId, projectId));
  }

  async getLogs(projectId: string): Promise<BuildLog[]> {
    return db.select().from(buildLogs).where(eq(buildLogs.projectId, projectId)).orderBy(buildLogs.createdAt);
  }

  async createLog(data: InsertBuildLog): Promise<BuildLog> {
    const [l] = await db.insert(buildLogs).values(data).returning();
    return l;
  }

  async clearLogs(projectId: string): Promise<void> {
    await db.delete(buildLogs).where(eq(buildLogs.projectId, projectId));
  }

  async getDeployments(projectId: string): Promise<Deployment[]> {
    return db.select().from(deployments).where(eq(deployments.projectId, projectId)).orderBy(desc(deployments.createdAt));
  }

  async createDeployment(data: InsertDeployment): Promise<Deployment> {
    const [d] = await db.insert(deployments).values(data).returning();
    return d;
  }

  async updateDeployment(id: string, data: Partial<any>): Promise<Deployment | undefined> {
    const [d] = await db.update(deployments).set(data).where(eq(deployments.id, id)).returning();
    return d;
  }

  async getSecrets(projectId: string): Promise<ProjectSecret[]> {
    return db.select().from(projectSecrets).where(eq(projectSecrets.projectId, projectId)).orderBy(projectSecrets.createdAt);
  }

  async createSecret(data: InsertSecret): Promise<ProjectSecret> {
    const [s] = await db.insert(projectSecrets).values(data).returning();
    return s;
  }

  async updateSecret(id: string, value: string): Promise<ProjectSecret | undefined> {
    const [s] = await db.update(projectSecrets).set({ value }).where(eq(projectSecrets.id, id)).returning();
    return s;
  }

  async deleteSecret(id: string): Promise<void> {
    await db.delete(projectSecrets).where(eq(projectSecrets.id, id));
  }

  async getGitCommits(projectId: string): Promise<GitCommit[]> {
    return db.select().from(gitCommits).where(eq(gitCommits.projectId, projectId)).orderBy(desc(gitCommits.createdAt));
  }

  async createGitCommit(data: InsertGitCommit): Promise<GitCommit> {
    const [c] = await db.insert(gitCommits).values(data).returning();
    return c;
  }
}

export const storage = new DatabaseStorage();
