import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
//#region src/index.ts
/**
* Plugin market bundle, node half. A same-origin HTTP route the browser panel
* calls to install a plugin: it mirrors the official `dsh plugin` pnpm-forwarder
* (run `pnpm add <source>` in the web profile, then reconcile
* `dsh.profile.bundles` for dependencies that declare `dsh.bundle`).
*
* Progress is streamed through a polling job: POST /install starts the async
* `pnpm add` and returns a job id; GET /job/<id> returns the accumulated
* stdout/stderr and status. No official remote namespace is required — the
* panel fetches this route directly, like dsh-external/plugin-console.
*/
/** `$DSH_HOME`, falling back to the platform home's `.dsh`. */
function dshHome() {
	const env = process.env.DSH_HOME?.trim();
	if (env !== void 0 && env !== "") return env;
	return join(process.env.HOME ?? process.env.USERPROFILE ?? ".", ".dsh");
}
/** The web profile directory (the running `dsh web` profile). */
function profileWebDir() {
	return join(dshHome(), "profiles", "web");
}
function readProfileManifest() {
	try {
		return JSON.parse(readFileSync(join(profileWebDir(), "package.json"), "utf8"));
	} catch {
		return {};
	}
}
function writeProfileManifest(manifest) {
	writeFileSync(join(profileWebDir(), "package.json"), `${JSON.stringify(manifest, void 0, 2)}\n`);
}
/** Whether an installed package contributes a profile layer (`dsh.bundle`). */
function declaresBundle(packageName) {
	try {
		return JSON.parse(readFileSync(join(profileWebDir(), "node_modules", packageName, "package.json"), "utf8")).dsh?.bundle?.patch !== void 0;
	} catch {
		return false;
	}
}
/** Append `dsh.bundle` dependencies to the profile layer stack. */
function reconcileBundles() {
	const manifest = readProfileManifest();
	const bundles = manifest.dsh?.profile?.bundles ?? [];
	const joined = [];
	for (const name of Object.keys(manifest.dependencies ?? {})) if (declaresBundle(name) && !bundles.includes(name)) {
		bundles.push(name);
		joined.push(name);
	}
	if (joined.length === 0) return [];
	manifest.dsh = {
		...manifest.dsh,
		profile: {
			...manifest.dsh?.profile,
			bundles
		}
	};
	writeProfileManifest(manifest);
	return joined;
}
/** Normalize a package `repository` field to `owner/repo`, if it is GitHub. */
function normalizeRepo(repository) {
	if (repository === null || repository === void 0) return void 0;
	if (typeof repository === "object") return normalizeRepo(repository.url);
	if (typeof repository !== "string") return void 0;
	const value = repository.trim();
	const https = /github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(value);
	if (https !== null) return `${https[1]}/${https[2]}`.toLowerCase();
	const shorthand = /^github:([\w.-]+)\/([\w.-]+)$/i.exec(value);
	if (shorthand !== null) return `${shorthand[1]}/${shorthand[2]}`.toLowerCase();
}
/** Enumerate the plugins installed in the web profile (top-level deps only). */
function listInstalledPlugins() {
	const manifest = readProfileManifest();
	const result = [];
	for (const name of Object.keys(manifest.dependencies ?? {})) {
		const spec = manifest.dependencies?.[name] ?? "";
		try {
			const pkg = JSON.parse(readFileSync(join(profileWebDir(), "node_modules", name, "package.json"), "utf8"));
			result.push({
				name: pkg.name ?? name,
				version: pkg.version ?? "",
				repo: normalizeRepo(pkg.repository),
				broken: false
			});
		} catch {
			const githubSpec = /^github:([^/]+\/[^/]+)$/.exec(spec);
			result.push({
				name,
				version: "",
				repo: githubSpec !== null ? githubSpec[1].toLowerCase() : void 0,
				broken: true
			});
		}
	}
	return result;
}
/** Remove a dependency (and its bundle entry) from the web profile manifest. */
function cleanupPlugin(name) {
	const manifest = readProfileManifest();
	const deps = { ...manifest.dependencies ?? {} };
	delete deps[name];
	manifest.dependencies = deps;
	const bundles = [...manifest.dsh?.profile?.bundles ?? []];
	const without = bundles.filter((bundle) => bundle !== name);
	manifest.dsh = {
		...manifest.dsh,
		profile: {
			...manifest.dsh?.profile,
			bundles: without
		}
	};
	writeProfileManifest(manifest);
	return bundles.length === without.length ? [] : [name];
}
/** Remove an installed plugin: profile dependency/bundle + on-disk artifacts. */
function uninstallPlugin(name, type, repoName) {
	if (name === "dsh-plugin-market") return "refusing to uninstall the market itself";
	const manifest = readProfileManifest();
	const deps = { ...manifest.dependencies ?? {} };
	delete deps[name];
	manifest.dependencies = deps;
	const bundles = [...manifest.dsh?.profile?.bundles ?? []];
	manifest.dsh = {
		...manifest.dsh,
		profile: {
			...manifest.dsh?.profile,
			bundles: bundles.filter((bundle) => bundle !== name)
		}
	};
	writeProfileManifest(manifest);
	try {
		rmSync(join(profileWebDir(), "node_modules", name), {
			recursive: true,
			force: true
		});
	} catch {}
	const target = type === "skill" ? join(dshHome(), "skills", repoName) : type === "preset" ? join(dshHome(), ".agent-presets", repoName) : type === "script" ? join(dshHome(), "marketplace", "cache", repoName) : null;
	if (target !== null) try {
		rmSync(target, {
			recursive: true,
			force: true
		});
	} catch {}
	return "";
}
const jobs = /* @__PURE__ */ new Map();
/** Run install steps sequentially, streaming each process into the job. */
function runSteps(job, steps, index) {
	if (index >= steps.length) {
		try {
			job.joined = reconcileBundles();
		} catch (error) {
			job.output += `\nreconcile failed: ${error instanceof Error ? error.message : String(error)}`;
		}
		job.status = "done";
		return;
	}
	const step = steps[index];
	const child = spawn(step.argv[0], step.argv.slice(1), {
		cwd: step.cwd,
		shell: process.platform === "win32"
	});
	job.child = child;
	child.stdout?.on("data", (chunk) => {
		job.output += chunk.toString("utf8");
	});
	child.stderr?.on("data", (chunk) => {
		job.output += chunk.toString("utf8");
	});
	child.on("error", (error) => {
		job.status = "error";
		job.output += `\n${error.message}`;
	});
	child.on("close", (code) => {
		if (job.status === "canceled") return;
		job.exitCode = code;
		if (code !== 0) {
			job.status = "error";
			if (index === 0 && step.argv[0] === "pnpm") job.output += "\nIf pnpm blocked a build script, add the printed key to allowBuilds in the profile pnpm-workspace.yaml, then retry.";
			return;
		}
		runSteps(job, steps, index + 1);
	});
}
/** Services required by the install route. */
const inject = ["webServer"];
/**
* Register the `/api/plugin-market` route.
* @param ctx - Cordis context carrying the web server.
* @returns disposer unregistered by the effect when the plugin disposes.
*/
function apply(ctx) {
	const webServer = ctx.webServer;
	if (webServer === void 0) return;
	ctx.effect(() => {
		const disposeRoutes = webServer.register({
			kind: "prefix",
			path: "/api/plugin-market",
			handler: (req, res) => {
				const json = (status, body) => {
					res.statusCode = status;
					res.setHeader("content-type", "application/json");
					res.end(JSON.stringify(body));
				};
				const method = req.method ?? "GET";
				const path = (req.url ?? "/").split("?")[0] ?? "/";
				if (method === "POST" && (path === "/api/plugin-market/install" || path === "/api/plugin-market/install/")) {
					let body = "";
					req.on("data", (chunk) => {
						body += chunk.toString("utf8");
					});
					req.on("end", () => {
						let parsed;
						try {
							parsed = JSON.parse(body);
						} catch {
							json(400, {
								ok: false,
								message: "invalid JSON body"
							});
							return;
						}
						const source = (parsed.source ?? "").trim();
						if (source.length === 0) {
							json(400, {
								ok: false,
								message: "install needs a source"
							});
							return;
						}
						const type = parsed.type === "skill" || parsed.type === "preset" || parsed.type === "script" ? parsed.type : "plugin";
						const jobId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
						const job = {
							status: "running",
							output: "",
							exitCode: null,
							joined: []
						};
						jobs.set(jobId, job);
						const fullName = source.replace(/^github:/, "");
						const repoName = fullName.split("/")[1] ?? fullName;
						const cloneUrl = `https://github.com/${fullName}.git`;
						const steps = [];
						if (type === "skill") {
							const skillsDir = join(dshHome(), "skills");
							mkdirSync(skillsDir, { recursive: true });
							steps.push({
								argv: [
									"git",
									"clone",
									"--depth",
									"1",
									cloneUrl,
									join(skillsDir, repoName)
								],
								cwd: dshHome()
							});
						} else if (type === "preset") {
							const presetsDir = join(dshHome(), ".agent-presets");
							mkdirSync(presetsDir, { recursive: true });
							steps.push({
								argv: [
									"git",
									"clone",
									"--depth",
									"1",
									cloneUrl,
									join(presetsDir, repoName)
								],
								cwd: dshHome()
							});
						} else if (type === "script") {
							const cacheDir = join(dshHome(), "marketplace", "cache");
							mkdirSync(cacheDir, { recursive: true });
							steps.push({
								argv: [
									"git",
									"clone",
									"--depth",
									"1",
									cloneUrl,
									join(cacheDir, repoName)
								],
								cwd: dshHome()
							});
							const script = process.platform === "win32" ? "install.ps1" : "install.sh";
							steps.push({
								argv: process.platform === "win32" ? [
									"powershell",
									"-NoProfile",
									"-ExecutionPolicy",
									"Bypass",
									"-File",
									join(cacheDir, repoName, script)
								] : ["bash", join(cacheDir, repoName, script)],
								cwd: join(cacheDir, repoName)
							});
						} else steps.push({
							argv: [
								"pnpm",
								"add",
								source
							],
							cwd: profileWebDir()
						});
						runSteps(job, steps, 0);
						json(202, {
							ok: true,
							jobId
						});
					});
					return;
				}
				if (method === "POST" && (path === "/api/plugin-market/cleanup" || path === "/api/plugin-market/cleanup/")) {
					let body = "";
					req.on("data", (chunk) => {
						body += chunk.toString("utf8");
					});
					req.on("end", () => {
						let parsed;
						try {
							parsed = JSON.parse(body);
						} catch {
							json(400, {
								ok: false,
								message: "invalid JSON body"
							});
							return;
						}
						const name = (parsed.name ?? "").trim();
						if (name.length === 0) {
							json(400, {
								ok: false,
								message: "cleanup needs a name"
							});
							return;
						}
						json(200, {
							ok: true,
							bundlesRemoved: cleanupPlugin(name)
						});
					});
					return;
				}
				if (method === "POST" && (path === "/api/plugin-market/uninstall" || path === "/api/plugin-market/uninstall/")) {
					let body = "";
					req.on("data", (chunk) => {
						body += chunk.toString("utf8");
					});
					req.on("end", () => {
						let parsed;
						try {
							parsed = JSON.parse(body);
						} catch {
							json(400, {
								ok: false,
								message: "invalid JSON body"
							});
							return;
						}
						const name = (parsed.name ?? "").trim();
						if (name.length === 0) {
							json(400, {
								ok: false,
								message: "uninstall needs a name"
							});
							return;
						}
						const message = uninstallPlugin(name, parsed.type === "skill" || parsed.type === "preset" || parsed.type === "script" ? parsed.type : "plugin", parsed.repoName ?? "");
						if (message.length > 0) {
							json(400, {
								ok: false,
								message
							});
							return;
						}
						json(200, { ok: true });
					});
					return;
				}
				if (method === "GET" && (path === "/api/plugin-market/self" || path === "/api/plugin-market/self/")) {
					let repo;
					try {
						repo = normalizeRepo(JSON.parse(readFileSync(join(profileWebDir(), "node_modules", "dsh-plugin-market", "package.json"), "utf8")).repository);
					} catch {}
					json(200, {
						ok: true,
						repo: repo ?? "TheYoungChen/dsh-plugin-market"
					});
					return;
				}
				if (method === "GET" && (path === "/api/plugin-market/installed" || path === "/api/plugin-market/installed/")) {
					json(200, {
						ok: true,
						plugins: listInstalledPlugins(),
						bundles: readProfileManifest().dsh?.profile?.bundles ?? []
					});
					return;
				}
				const cancelMatch = /^\/api\/plugin-market\/job\/([^/]+)\/cancel$/.exec(path);
				if (method === "POST" && cancelMatch !== null) {
					const job = jobs.get(decodeURIComponent(cancelMatch[1]));
					if (job === void 0) {
						json(404, {
							ok: false,
							message: "unknown job"
						});
						return;
					}
					job.status = "canceled";
					if (job.child !== void 0) if (process.platform === "win32" && job.child.pid !== void 0) try {
						spawn("taskkill", [
							"/pid",
							String(job.child.pid),
							"/T",
							"/F"
						], { stdio: "ignore" });
					} catch {
						job.child.kill();
					}
					else job.child.kill();
					json(200, { ok: true });
					return;
				}
				const jobMatch = /^\/api\/plugin-market\/job\/([^/]+)$/.exec(path);
				if (method === "GET" && jobMatch !== null) {
					const job = jobs.get(decodeURIComponent(jobMatch[1]));
					if (job === void 0) {
						json(404, {
							ok: false,
							message: "unknown job"
						});
						return;
					}
					json(200, {
						ok: true,
						status: job.status,
						output: job.output,
						exitCode: job.exitCode,
						joined: job.joined
					});
					return;
				}
				json(404, {
					ok: false,
					message: "not found"
				});
			}
		});
		return () => {
			disposeRoutes();
		};
	}, "plugin-market: install route");
}
//#endregion
export { apply, inject };
