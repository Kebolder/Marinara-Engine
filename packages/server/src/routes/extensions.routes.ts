// ──────────────────────────────────────────────
// Routes: Installed Extensions
// ──────────────────────────────────────────────
//
// CRUD plus runtime status. Browser extension JS is fetched as part of the
// list payload and loaded client-side by `CustomThemeInjector.tsx`; server
// extension JS is executed by `serverExtensionRuntime`. There is no separate
// script-serving endpoint.
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";
import { createExtensionSchema, updateExtensionSchema, type InstalledExtension } from "@marinara-engine/shared";
import { createExtensionsStorage } from "../services/storage/extensions.storage.js";
import { requirePrivilegedAccess } from "../middleware/privileged-gate.js";
import { serverExtensionRuntime } from "../services/extensions/server-extension-runtime.js";

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export async function extensionsRoutes(app: FastifyInstance) {
  const storage = createExtensionsStorage(app.db);
  const withStatus = <T extends Awaited<ReturnType<typeof storage.getById>>>(extension: T): T =>
    (extension ? serverExtensionRuntime.withRuntimeStatus(extension) : extension) as T;
  const toPublicExtension = (extension: InstalledExtension): InstalledExtension => {
    const withRuntimeStatus = serverExtensionRuntime.withRuntimeStatus(extension);
    return withRuntimeStatus.runtime === "server" ? { ...withRuntimeStatus, serverJs: null } : withRuntimeStatus;
  };

  app.get("/", async () => {
    const extensions = await storage.list();
    return extensions.map(toPublicExtension);
  });

  app.post("/", async (req, reply) => {
    if (!requirePrivilegedAccess(req, reply, { feature: "Extension install/update/delete" })) return;
    const input = createExtensionSchema.parse(req.body);
    const created = await storage.create(input);
    if (created?.runtime === "server") await serverExtensionRuntime.reloadExtension(created.id);
    return withStatus(created);
  });

  app.patch<{ Params: { id: string } }>("/:id", async (req, reply) => {
    if (!requirePrivilegedAccess(req, reply, { feature: "Extension install/update/delete" })) return;
    if (!ID_PATTERN.test(req.params.id)) {
      return reply.status(404).send({ error: "Extension not found" });
    }
    const data = updateExtensionSchema.parse(req.body);
    const existing = await storage.getById(req.params.id);
    if (!existing) return reply.status(404).send({ error: "Extension not found" });
    const updated = await storage.update(req.params.id, data);
    if (existing.runtime === "server" || updated?.runtime === "server") {
      await serverExtensionRuntime.reloadExtension(req.params.id);
    }
    return withStatus(updated);
  });

  app.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    if (!requirePrivilegedAccess(req, reply, { feature: "Extension install/update/delete" })) return;
    if (!ID_PATTERN.test(req.params.id)) {
      return reply.status(404).send({ error: "Extension not found" });
    }
    const existing = await storage.getById(req.params.id);
    if (!existing) return reply.status(404).send({ error: "Extension not found" });
    await storage.remove(req.params.id);
    if (existing.runtime === "server") await serverExtensionRuntime.unloadExtension(existing.id);
    return reply.status(204).send();
  });
}
