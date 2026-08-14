window.__ModuleLoader__.load({
	id: "dsh-plugin-market",
	factory: (require) => {
		var exports = { exports: {} }.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/github.ts
		/** Repos tagged `dsh-plugin` that are not the harness itself. */
		const EXCLUDED = new Set(["deepseek-ai/deepseek-harness"]);
		/**
		* Fetch one page of the `dsh-plugin` topic, sorted by stars.
		* @param page - 1-based page number.
		* @param perPage - repositories per page (GitHub caps at 100).
		* @param search - optional free-text filter combined with the topic.
		* @returns the page plus the topic total.
		*/
		async function fetchMarketPage(page, perPage, search = "") {
			const term = search.trim().length > 0 ? `topic:dsh-plugin ${search.trim()}` : "topic:dsh-plugin";
			const params = new URLSearchParams({
				q: term,
				sort: "stars",
				order: "desc",
				per_page: String(perPage),
				page: String(page)
			});
			const response = await fetch(`https://api.github.com/search/repositories?${params.toString()}`, { headers: { Accept: "application/vnd.github+json" } });
			if (!response.ok) throw new Error(`GitHub search failed: ${response.status} ${response.statusText}`);
			const payload = await response.json();
			const items = (payload.items ?? []).map((item) => ({
				fullName: item.full_name ?? "",
				name: item.name ?? "",
				description: item.description ?? "",
				stars: item.stargazers_count ?? 0,
				htmlUrl: item.html_url ?? ""
			})).filter((item) => item.fullName.length > 0 && !EXCLUDED.has(item.fullName));
			return {
				items,
				totalCount: payload.total_count ?? items.length
			};
		}
		//#endregion
		//#region src/client/api.ts
		/**
		* Start installing one source (`github:owner/repo`).
		* @param source - the pnpm install spec.
		* @returns the job id to poll.
		*/
		async function startInstall(source) {
			const response = await fetch("/api/plugin-market/install", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ source })
			});
			const payload = await response.json();
			if (!response.ok || payload.ok !== true || payload.jobId === void 0) throw new Error(payload.message ?? `install failed: ${response.status}`);
			return payload.jobId;
		}
		/** Poll one install job for progress. */
		async function pollInstall(jobId) {
			const response = await fetch(`/api/plugin-market/job/${encodeURIComponent(jobId)}`);
			const payload = await response.json();
			if (!response.ok || payload.ok !== true) throw new Error(payload.message ?? `job poll failed: ${response.status}`);
			return payload;
		}
		/** Cancel a running install job (kills the underlying `pnpm add`). */
		async function cancelInstall(jobId) {
			const response = await fetch(`/api/plugin-market/job/${encodeURIComponent(jobId)}/cancel`, { method: "POST" });
			const payload = await response.json();
			if (!response.ok || payload.ok !== true) throw new Error(payload.message ?? `cancel failed: ${response.status}`);
		}
		//#endregion
		//#region src/client/installStore.ts
		/** Module-level store of install jobs, shared by the modal and the toast. */
		const jobs = /* @__PURE__ */ new Map();
		const listeners = /* @__PURE__ */ new Set();
		function notify() {
			for (const listener of listeners) listener();
		}
		function patch(id, update) {
			const current = jobs.get(id);
			if (current === void 0) return;
			jobs.set(id, {
				...current,
				...update
			});
			notify();
		}
		/** Subscribe to any store change. Returns an unsubscribe function. */
		function subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		}
		/** Current jobs (a fresh array per call; hooks re-render via subscribe). */
		function getJobs() {
			return [...jobs.values()];
		}
		/** React hook: the live list of install jobs. */
		function useInstallJobs() {
			const [snapshot, setSnapshot] = (0, react.useState)(() => getJobs());
			(0, react.useEffect)(() => subscribe(() => {
				setSnapshot(getJobs());
			}), []);
			return snapshot;
		}
		async function poll(id) {
			for (;;) {
				const current = jobs.get(id);
				if (current === void 0 || current.status === "canceled") return;
				try {
					const state = await pollInstall(id);
					const after = jobs.get(id);
					if (after === void 0 || after.status === "canceled") return;
					patch(id, {
						status: state.status === "done" ? "done" : state.status === "error" ? "error" : state.status === "canceled" ? "canceled" : "running",
						output: state.output
					});
					if (state.status !== "running") return;
				} catch (error) {
					patch(id, {
						status: "error",
						output: error instanceof Error ? error.message : String(error)
					});
					return;
				}
				await new Promise((resolve) => window.setTimeout(resolve, 600));
			}
		}
		/** Start an install and return its job id (synthetic on a failed start). */
		async function beginInstall(name, source) {
			let id;
			try {
				id = await startInstall(source);
			} catch (error) {
				id = `error-${Date.now().toString(36)}`;
				jobs.set(id, {
					id,
					name,
					source,
					status: "error",
					backgrounded: false,
					startedAt: Date.now(),
					output: error instanceof Error ? error.message : String(error)
				});
				notify();
				return id;
			}
			jobs.set(id, {
				id,
				name,
				source,
				status: "running",
				output: "",
				backgrounded: false,
				startedAt: Date.now()
			});
			notify();
			poll(id);
			return id;
		}
		/** Move a job to the background (dismiss the modal, keep the toast). */
		function backgroundJob(id) {
			patch(id, { backgrounded: true });
		}
		/** Cancel a running job (kills the underlying `pnpm add`). */
		async function cancelJob(id) {
			patch(id, { status: "canceled" });
			try {
				await cancelInstall(id);
			} catch {}
		}
		/** Remove a job from the store (toast dismissed or modal closed after finish). */
		function dismissJob(id) {
			jobs.delete(id);
			notify();
		}
		let spinInjected = false;
		/** Inject the spinner keyframes once, for the loading glyph animation. */
		function ensureSpinKeyframe() {
			if (spinInjected || typeof document === "undefined") return;
			spinInjected = true;
			const style = document.createElement("style");
			style.textContent = "@keyframes dsh-market-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}";
			document.head.appendChild(style);
		}
		//#endregion
		//#region src/client/MarketBrowser.tsx
		/** Shared market browser: search + paginated list + install flow. */
		/** Repositories fetched per page. */
		const PER_PAGE = 20;
		/** The profile the install targets; the web surface boots as `web`. */
		const DEFAULT_PROFILE = "web";
		/** Official guide for authoring and publishing a plugin. */
		const GUIDE_URL = "https://github.com/deepseek-ai/deepseek-harness";
		/** Ticking elapsed-seconds display for a live install. */
		function useElapsed(startedAt, active) {
			const [now, setNow] = (0, react.useState)(() => Date.now());
			(0, react.useEffect)(() => {
				if (!active) return;
				const timer = window.setInterval(() => {
					setNow(Date.now());
				}, 1e3);
				return () => {
					window.clearInterval(timer);
				};
			}, [active]);
			return Math.max(0, Math.floor((now - startedAt) / 1e3));
		}
		const searchStyle = {
			display: "flex",
			alignItems: "center",
			gap: 6,
			minWidth: 0,
			padding: "6px 9px",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 8,
			color: "var(--dsw-alias-label-tertiary)"
		};
		const searchInputStyle = {
			flex: 1,
			minWidth: 0,
			border: 0,
			background: "transparent",
			color: "var(--dsw-alias-label-primary)",
			fontSize: 13,
			outline: "none",
			fontFamily: "inherit"
		};
		const bodyStyle = {
			flex: 1,
			minHeight: 0,
			overflowY: "auto",
			padding: "12px 14px"
		};
		const statusTextStyle = {
			padding: "12px 0",
			margin: 0,
			color: "var(--dsw-alias-label-tertiary)",
			fontSize: 13,
			lineHeight: "18px"
		};
		const cardsStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 10,
			margin: 0,
			padding: 0,
			listStyle: "none"
		};
		const cardStyle = {
			display: "flex",
			alignItems: "flex-start",
			gap: 12,
			padding: "12px 14px",
			border: "1px solid var(--dsw-alias-border-l1)",
			borderRadius: 12,
			background: "var(--dsw-alias-bg-base)"
		};
		const cardBodyStyle = {
			flex: 1,
			minWidth: 0
		};
		const cardNameStyle = {
			display: "inline-flex",
			alignItems: "center",
			gap: 4,
			fontSize: 14,
			fontWeight: 600,
			color: "var(--dsw-alias-label-primary)",
			textDecoration: "none",
			overflowWrap: "anywhere"
		};
		const cardNameTextStyle = { overflowWrap: "anywhere" };
		const cardDescStyle = {
			margin: "5px 0 0",
			fontSize: 13,
			lineHeight: 1.5,
			color: "var(--dsw-alias-label-tertiary)",
			display: "-webkit-box",
			WebkitLineClamp: 3,
			WebkitBoxOrient: "vertical",
			overflow: "hidden"
		};
		const cardTrailingStyle = {
			display: "flex",
			flexDirection: "column",
			alignItems: "flex-end",
			gap: 8,
			flexShrink: 0
		};
		const starsStyle = {
			display: "inline-flex",
			alignItems: "center",
			gap: 4,
			fontSize: 12,
			color: "var(--dsw-alias-label-secondary)",
			whiteSpace: "nowrap",
			fontVariantNumeric: "tabular-nums"
		};
		const starGlyphStyle = {
			color: "#e3b341",
			fontSize: 13,
			lineHeight: 1
		};
		const installButtonStyle = {
			padding: "5px 12px",
			border: 0,
			borderRadius: 8,
			background: "var(--dsw-alias-action-primary, #4c8dff)",
			color: "#fff",
			fontSize: 13,
			cursor: "pointer"
		};
		const paginationStyle = {
			flex: "none",
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			gap: 14,
			padding: "10px 14px",
			borderTop: "1px solid var(--dsw-alias-border-l2)"
		};
		const pageButtonStyle = {
			padding: "5px 12px",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 8,
			background: "transparent",
			color: "var(--dsw-alias-label-primary)",
			fontSize: 13,
			cursor: "pointer"
		};
		const pageIndicatorStyle = {
			fontSize: 13,
			color: "var(--dsw-alias-label-tertiary)",
			fontVariantNumeric: "tabular-nums"
		};
		const countStyle = {
			margin: "0 0 8px",
			fontSize: 12,
			color: "var(--dsw-alias-label-tertiary)",
			fontVariantNumeric: "tabular-nums"
		};
		const guideStyle = {
			flexShrink: 0,
			fontSize: 13,
			color: "var(--dsw-alias-state-business-primary, #4c8dff)",
			textDecoration: "none",
			whiteSpace: "nowrap"
		};
		const dialogBackdropStyle = {
			position: "fixed",
			inset: 0,
			zIndex: 50,
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			background: "rgba(0,0,0,0.55)"
		};
		const dialogStyle = {
			width: "min(520px, calc(100vw - 32px))",
			padding: 16,
			border: "1px solid var(--dsw-alias-border-l1)",
			borderRadius: 12,
			background: "var(--dsw-alias-bg-base)",
			color: "var(--dsw-alias-label-primary)",
			boxShadow: "var(--dsw-shadow-lv2)"
		};
		const dialogTitleStyle = {
			margin: "0 0 8px",
			fontSize: 14
		};
		const dialogBodyStyle = {
			margin: "0 0 8px",
			fontSize: 12,
			color: "var(--dsw-alias-label-tertiary)",
			overflowWrap: "anywhere"
		};
		const commandStyle = {
			display: "block",
			padding: "8px 10px",
			marginBottom: 12,
			overflowX: "auto",
			borderRadius: 6,
			background: "rgba(0,0,0,0.3)",
			fontSize: 12,
			whiteSpace: "nowrap"
		};
		const outputStyle = {
			display: "block",
			padding: "8px 10px",
			margin: "8px 0",
			maxHeight: 220,
			overflowY: "auto",
			borderRadius: 6,
			background: "rgba(0,0,0,0.3)",
			fontSize: 11,
			whiteSpace: "pre-wrap",
			fontFamily: "ui-monospace, monospace",
			wordBreak: "break-word"
		};
		const runningStyle = {
			display: "flex",
			alignItems: "center",
			gap: 8,
			margin: "0 0 4px",
			fontSize: 13,
			color: "var(--dsw-alias-label-secondary)"
		};
		const spinStyle$1 = {
			display: "inline-flex",
			animation: "dsh-market-spin 1s linear infinite"
		};
		const outputLabelStyle = {
			fontSize: 11,
			color: "var(--dsw-alias-label-tertiary)"
		};
		const actionsStyle = {
			display: "flex",
			justifyContent: "flex-end",
			gap: 8
		};
		const actionButtonStyle = {
			display: "inline-flex",
			alignItems: "center",
			gap: 4,
			padding: "5px 10px",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 6,
			background: "transparent",
			color: "inherit",
			fontSize: 12,
			cursor: "pointer",
			textDecoration: "none"
		};
		const dangerButtonStyle = {
			...actionButtonStyle,
			color: "var(--dsw-alias-state-error-primary)"
		};
		const primaryButtonStyle = {
			...actionButtonStyle,
			borderColor: "transparent",
			background: "var(--dsw-alias-action-primary, #4c8dff)",
			color: "#fff"
		};
		const errorTextStyle = {
			margin: 0,
			fontSize: 12,
			color: "var(--dsw-alias-state-error-primary)"
		};
		const successTextStyle = {
			margin: 0,
			fontSize: 12,
			color: "var(--dsw-alias-state-success-primary)"
		};
		/** The market list, shared by the sidebar modal and the Settings tab. */
		function MarketBrowser({ t }) {
			const [view, setView] = (0, react.useState)({ status: "idle" });
			const [query, setQuery] = (0, react.useState)("");
			const [confirming, setConfirming] = (0, react.useState)(null);
			const [foregroundId, setForegroundId] = (0, react.useState)(null);
			const jobs = useInstallJobs();
			(0, react.useEffect)(() => {
				ensureSpinKeyframe();
			}, []);
			const foreground = jobs.find((job) => job.id === foregroundId) ?? null;
			const elapsed = useElapsed(foreground?.startedAt ?? Date.now(), foreground?.status === "running");
			const load = (page, search) => {
				setView({ status: "loading" });
				fetchMarketPage(page, PER_PAGE, search).then((result) => setView({
					status: "ready",
					plugins: result.items,
					totalCount: result.totalCount,
					page
				}), (error) => setView({
					status: "error",
					message: error instanceof Error ? error.message : String(error)
				}));
			};
			(0, react.useEffect)(() => {
				if (view.status !== "idle") return;
				load(1, "");
			}, [view.status]);
			(0, react.useEffect)(() => {
				const timer = window.setTimeout(() => {
					load(1, query.trim());
				}, 400);
				return () => {
					window.clearTimeout(timer);
				};
			}, [query]);
			const stop = (event) => {
				event.stopPropagation();
			};
			const onConfirmInstall = async (plugin) => {
				const source = `github:${plugin.fullName}`;
				setConfirming(null);
				setForegroundId(await beginInstall(plugin.name, source));
			};
			const page = view.status === "ready" ? view.page : 1;
			const totalPages = view.status === "ready" ? Math.max(1, Math.ceil(view.totalCount / PER_PAGE)) : 1;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						flex: "none",
						display: "flex",
						alignItems: "center",
						gap: 8,
						padding: "10px 14px 0"
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						style: {
							...searchStyle,
							flex: 1
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSearchOutline16, { "aria-hidden": "true" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "search",
							style: searchInputStyle,
							value: query,
							placeholder: t("search"),
							"aria-label": t("search"),
							onChange: (event) => {
								setQuery(event.currentTarget.value);
							}
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
						style: guideStyle,
						href: GUIDE_URL,
						target: "_blank",
						rel: "noreferrer noopener",
						children: t("guide")
					})]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: bodyStyle,
					children: [
						view.status === "ready" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: countStyle,
							children: t("count", { total: view.totalCount })
						}) : null,
						view.status === "loading" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: statusTextStyle,
							children: t("loading")
						}) : null,
						view.status === "error" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							role: "alert",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: errorTextStyle,
								children: t("error", { message: view.message })
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: actionButtonStyle,
								onClick: () => {
									load(page, query.trim());
								},
								children: t("retry")
							})]
						}) : null,
						view.status === "ready" && view.plugins.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: statusTextStyle,
							children: t("empty")
						}) : null,
						view.status === "ready" && view.plugins.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
							style: cardsStyle,
							children: view.plugins.map((plugin) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
								style: cardStyle,
								"data-market-plugin": plugin.fullName,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: cardBodyStyle,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("a", {
										style: cardNameStyle,
										href: plugin.htmlUrl,
										target: "_blank",
										rel: "noreferrer noopener",
										"aria-label": t("open.aria", { name: plugin.fullName }),
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: cardNameTextStyle,
											children: plugin.fullName
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRightUpOutline16, { size: 12 })]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										style: cardDescStyle,
										children: plugin.description
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: cardTrailingStyle,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										style: starsStyle,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: starGlyphStyle,
											"aria-hidden": true,
											children: "★"
										}), plugin.stars]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										style: installButtonStyle,
										"data-market-install": plugin.fullName,
										onClick: () => {
											setConfirming(plugin);
										},
										children: t("install")
									})]
								})]
							}, plugin.fullName))
						}) : null
					]
				}),
				view.status === "ready" && view.plugins.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("footer", {
					style: paginationStyle,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: pageButtonStyle,
							disabled: page <= 1,
							onClick: () => {
								load(page - 1, query.trim());
							},
							children: t("prev")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: pageIndicatorStyle,
							children: t("page", {
								page,
								total: totalPages
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: pageButtonStyle,
							disabled: page >= totalPages,
							onClick: () => {
								load(page + 1, query.trim());
							},
							children: t("next")
						})
					]
				}) : null,
				confirming !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: dialogBackdropStyle,
					onClick: () => {
						setConfirming(null);
					},
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: dialogStyle,
						role: "dialog",
						"aria-modal": "true",
						"aria-label": t("confirm.title", { name: confirming.name }),
						onClick: stop,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								style: dialogTitleStyle,
								children: t("confirm.title", { name: confirming.name })
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: dialogBodyStyle,
								children: t("confirm.body", {
									source: `github:${confirming.fullName}`,
									profile: DEFAULT_PROFILE
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("code", {
								style: commandStyle,
								children: [
									"dsh plugin --profile ",
									DEFAULT_PROFILE,
									" add github:",
									confirming.fullName
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: actionsStyle,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: actionButtonStyle,
									onClick: () => {
										setConfirming(null);
									},
									children: t("confirm.cancel")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: primaryButtonStyle,
									onClick: () => {
										onConfirmInstall(confirming);
									},
									children: t("confirm.start")
								})]
							})
						]
					})
				}) : null,
				foreground !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: dialogBackdropStyle,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: dialogStyle,
						role: "dialog",
						"aria-modal": "true",
						"aria-label": t("installing.title", { name: foreground.name }),
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								style: dialogTitleStyle,
								children: t("installing.title", { name: foreground.name })
							}),
							foreground.status === "running" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
								style: runningStyle,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: spinStyle$1,
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconLoadingOutline16, {})
									}),
									t("install.running"),
									" ",
									t("install.elapsed", { seconds: elapsed })
								]
							}) : null,
							foreground.status === "done" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: successTextStyle,
								children: t("installing.done")
							}) : null,
							foreground.status === "error" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: errorTextStyle,
								children: t("installing.failed")
							}) : null,
							foreground.status === "canceled" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: errorTextStyle,
								children: t("install.canceled")
							}) : null,
							foreground.output.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: outputLabelStyle,
								children: t("installing.output")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
								style: outputStyle,
								children: foreground.output
							})] }) : null,
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: actionsStyle,
								children: foreground.status === "running" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: dangerButtonStyle,
									onClick: () => {
										cancelJob(foreground.id);
									},
									children: t("install.terminate")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: primaryButtonStyle,
									onClick: () => {
										backgroundJob(foreground.id);
										setForegroundId(null);
									},
									children: t("install.background")
								})] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: primaryButtonStyle,
									onClick: () => {
										dismissJob(foreground.id);
										setForegroundId(null);
									},
									children: t("installing.close")
								})
							})
						]
					})
				}) : null
			] });
		}
		//#endregion
		//#region src/client/PluginMarketPanel.tsx
		/** Sidebar footer action: a market badge, the market modal, and install toasts. */
		const layerWideStyle = {
			position: "relative",
			flex: "none",
			display: "flex",
			alignItems: "center",
			width: "100%",
			height: 49,
			margin: "8px 0 0"
		};
		const layerRailStyle = {
			position: "relative",
			flex: "none",
			display: "flex",
			alignItems: "center",
			width: 36,
			height: 36,
			margin: 0
		};
		const footerButtonsWideStyle = {
			display: "flex",
			alignItems: "center",
			width: "100%"
		};
		const footerButtonsRailStyle = {
			display: "flex",
			flexDirection: "column",
			alignItems: "center",
			gap: 2
		};
		const badgeBaseStyle = {
			display: "inline-flex",
			alignItems: "center",
			gap: 8,
			border: "none",
			color: "var(--dsw-alias-label-primary)",
			fontFamily: "inherit",
			fontSize: 14,
			cursor: "pointer",
			overflow: "hidden"
		};
		const badgeWideStyle = {
			...badgeBaseStyle,
			width: "100%",
			height: 49,
			padding: "0 8px 0 6px",
			borderRadius: 12
		};
		const badgeRailStyle = {
			...badgeBaseStyle,
			justifyContent: "center",
			gap: 0,
			width: 36,
			height: 36,
			padding: 0,
			borderRadius: "50%"
		};
		const badgeLabelStyle = {
			minWidth: 0,
			overflow: "hidden",
			textOverflow: "ellipsis",
			whiteSpace: "nowrap"
		};
		const backdropStyle = {
			position: "fixed",
			inset: 0,
			zIndex: 40,
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			background: "rgba(0,0,0,0.5)"
		};
		const modalStyle = {
			display: "flex",
			flexDirection: "column",
			width: "min(720px, calc(100vw - 48px))",
			height: "min(80vh, 760px)",
			maxHeight: "calc(100vh - 48px)",
			overflow: "hidden",
			border: "1px solid var(--dsw-alias-border-l1)",
			borderRadius: 16,
			background: "var(--dsw-alias-bg-base)",
			boxShadow: "var(--dsw-shadow-lv2)"
		};
		const headerStyle = {
			flex: "none",
			display: "flex",
			alignItems: "center",
			justifyContent: "space-between",
			minHeight: 52,
			padding: "10px 14px",
			boxSizing: "border-box",
			borderBottom: "1px solid var(--dsw-alias-border-l2)",
			background: "var(--dsw-alias-bg-base)"
		};
		const titleStyle = {
			fontSize: 14,
			fontWeight: 600,
			lineHeight: "20px",
			color: "var(--dsw-alias-label-primary)",
			whiteSpace: "nowrap"
		};
		const iconButtonStyle = {
			display: "inline-flex",
			alignItems: "center",
			justifyContent: "center",
			padding: 4,
			border: 0,
			borderRadius: 6,
			background: "transparent",
			color: "var(--dsw-alias-label-tertiary)",
			cursor: "pointer"
		};
		const toastStackStyle = {
			position: "fixed",
			top: 16,
			right: 16,
			zIndex: 60,
			display: "flex",
			flexDirection: "column",
			gap: 8,
			width: 320,
			maxWidth: "calc(100vw - 32px)"
		};
		const toastStyle = {
			display: "flex",
			alignItems: "center",
			gap: 10,
			padding: "10px 12px",
			border: "1px solid var(--dsw-alias-border-l1)",
			borderRadius: 12,
			background: "var(--dsw-alias-bg-base)",
			boxShadow: "var(--dsw-shadow-lv2)",
			color: "var(--dsw-alias-label-primary)"
		};
		const toastBodyStyle = {
			flex: 1,
			minWidth: 0,
			display: "flex",
			flexDirection: "column",
			gap: 2
		};
		const toastNameStyle = {
			fontSize: 13,
			fontWeight: 600,
			overflowWrap: "anywhere"
		};
		const toastStatusStyle = {
			fontSize: 12,
			color: "var(--dsw-alias-label-tertiary)",
			whiteSpace: "nowrap"
		};
		const spinStyle = {
			display: "inline-flex",
			flexShrink: 0,
			animation: "dsh-market-spin 1s linear infinite"
		};
		const toastRestartStyle = {
			flexShrink: 0,
			padding: "4px 10px",
			border: 0,
			borderRadius: 6,
			background: "var(--dsw-alias-action-primary, #4c8dff)",
			color: "#fff",
			fontSize: 12,
			cursor: "pointer"
		};
		const toastTerminateStyle = {
			flexShrink: 0,
			padding: "4px 8px",
			border: 0,
			borderRadius: 6,
			background: "transparent",
			color: "var(--dsw-alias-state-error-primary)",
			fontSize: 12,
			cursor: "pointer"
		};
		const toastCloseStyle = {
			flexShrink: 0,
			display: "inline-flex",
			alignItems: "center",
			justifyContent: "center",
			padding: 2,
			border: 0,
			borderRadius: 4,
			background: "transparent",
			color: "var(--dsw-alias-label-tertiary)",
			cursor: "pointer"
		};
		/** One background-install toast, with auto-dismiss on success. */
		function InstallToast({ job, t }) {
			const [now, setNow] = (0, react.useState)(() => Date.now());
			(0, react.useEffect)(() => {
				if (job.status !== "running") return;
				const timer = window.setInterval(() => {
					setNow(Date.now());
				}, 1e3);
				return () => {
					window.clearInterval(timer);
				};
			}, [job.status]);
			(0, react.useEffect)(() => {
				if (job.status !== "done") return;
				const timer = window.setTimeout(() => {
					dismissJob(job.id);
				}, 3e3);
				return () => {
					window.clearTimeout(timer);
				};
			}, [job.status, job.id]);
			const elapsed = Math.max(0, Math.floor((now - job.startedAt) / 1e3));
			const statusText = job.status === "running" ? `${t("toast.running")} · ${t("install.elapsed", { seconds: elapsed })}` : job.status === "done" ? t("toast.done") : job.status === "error" ? t("toast.failed") : t("toast.canceled");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: toastStyle,
				role: "status",
				children: [
					job.status === "running" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: spinStyle,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconLoadingOutline16, {})
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: toastBodyStyle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: toastNameStyle,
							children: job.name
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: toastStatusStyle,
							children: statusText
						})]
					}),
					job.status === "running" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						style: toastTerminateStyle,
						onClick: () => {
							cancelJob(job.id);
						},
						children: t("install.terminate")
					}) : null,
					job.status === "done" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						style: toastRestartStyle,
						onClick: () => {
							window.location.reload();
						},
						children: t("toast.restart")
					}) : null,
					job.status !== "running" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						style: toastCloseStyle,
						"aria-label": t("toast.close.aria"),
						onClick: () => {
							dismissJob(job.id);
						},
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCloseOutline16, { size: 14 })
					}) : null
				]
			});
		}
		/** Render the market badge, the modal it opens, and background install toasts. */
		function PluginMarketPanel({ wide, t }) {
			const [open, setOpen] = (0, react.useState)(false);
			const [hovered, setHovered] = (0, react.useState)(false);
			const background = useInstallJobs().filter((job) => job.backgrounded);
			(0, react.useEffect)(() => {
				ensureSpinKeyframe();
			}, []);
			(0, react.useEffect)(() => {
				if (!open) return;
				const onKey = (event) => {
					if (event.key === "Escape") setOpen(false);
				};
				window.addEventListener("keydown", onKey);
				return () => {
					window.removeEventListener("keydown", onKey);
				};
			}, [open]);
			const stop = (event) => {
				event.stopPropagation();
			};
			const badgeBackground = open ? "var(--dsw-alias-interactive-bg-hover)" : hovered ? "var(--dsw-alias-interactive-bg-hover-solid)" : "transparent";
			const badgeStyle = {
				...wide ? badgeWideStyle : badgeRailStyle,
				background: badgeBackground
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: wide ? layerWideStyle : layerRailStyle,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: wide ? footerButtonsWideStyle : footerButtonsRailStyle,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							style: badgeStyle,
							"aria-label": t("trigger.aria"),
							"aria-expanded": open,
							onMouseEnter: () => {
								setHovered(true);
							},
							onMouseLeave: () => {
								setHovered(false);
							},
							onClick: () => {
								setOpen((value) => !value);
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconArchiveOutline20, { size: wide ? 16 : 18 }), wide ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: badgeLabelStyle,
								children: t("trigger")
							}) : null]
						})
					}),
					open ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: backdropStyle,
						onClick: () => {
							setOpen(false);
						},
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
							style: modalStyle,
							role: "dialog",
							"aria-modal": "true",
							"aria-label": t("title"),
							onClick: stop,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
								style: headerStyle,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: titleStyle,
									children: t("title")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: iconButtonStyle,
									"aria-label": t("close"),
									onClick: () => {
										setOpen(false);
									},
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCloseOutline16, { size: 16 })
								})]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MarketBrowser, { t })]
						})
					}) : null,
					background.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: toastStackStyle,
						children: background.map((job) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(InstallToast, {
							job,
							t
						}, job.id))
					}) : null
				]
			});
		}
		//#endregion
		//#region src/client/MarketSettingsTab.tsx
		/** Render the market list inside the Plugins tab chrome. */
		function MarketSettingsTab({ t }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MarketBrowser, { t });
		}
		//#endregion
		//#region src/client/locales.ts
		/** Simplified Chinese market messages. */
		const zh = {
			"trigger": "插件市场",
			"trigger.aria": "插件市场",
			"title": "插件市场",
			"search": "搜索插件…",
			"loading": "加载中…",
			"error": "加载失败：{message}",
			"retry": "重试",
			"empty": "没有找到插件",
			"stars": "{count} stars",
			"install": "安装",
			"confirm.title": "安装 {name}",
			"confirm.body": "将把 {source} 安装到 profile “{profile}”，重启 dsh 后生效。",
			"confirm.start": "确认安装",
			"confirm.cancel": "取消",
			"installing.title": "正在安装 {name}",
			"installing.running": "安装中…",
			"installing.done": "安装完成，重启 dsh 后生效",
			"installing.failed": "安装失败",
			"installing.output": "安装输出",
			"installing.close": "关闭",
			"page": "第 {page} / {total} 页",
			"prev": "上一页",
			"next": "下一页",
			"close": "关闭",
			"open.aria": "在 GitHub 打开 {name}",
			"count": "共 {total} 个插件",
			"guide": "如何发布插件",
			"install.elapsed": "已 {seconds} 秒",
			"install.background": "后台下载",
			"install.terminate": "终止",
			"install.canceled": "已取消",
			"toast.running": "后台安装中",
			"toast.done": "安装完成",
			"toast.failed": "安装失败",
			"toast.canceled": "已取消",
			"toast.restart": "重启并生效",
			"toast.close.aria": "关闭通知"
		};
		/** English market messages. */
		const en = {
			"trigger": "Plugin Market",
			"trigger.aria": "Plugin market",
			"title": "Plugin Market",
			"search": "Search plugins…",
			"loading": "Loading…",
			"error": "Load failed: {message}",
			"retry": "Retry",
			"empty": "No plugins found",
			"stars": "{count} stars",
			"install": "Install",
			"confirm.title": "Install {name}",
			"confirm.body": "It will install {source} into the “{profile}” profile and take effect after restarting dsh.",
			"confirm.start": "Install",
			"confirm.cancel": "Cancel",
			"installing.title": "Installing {name}",
			"installing.running": "Installing…",
			"installing.done": "Installed — restart dsh to activate",
			"installing.failed": "Install failed",
			"installing.output": "Install output",
			"installing.close": "Close",
			"page": "Page {page} / {total}",
			"prev": "Previous",
			"next": "Next",
			"close": "Close",
			"open.aria": "Open {name} on GitHub",
			"count": "{total} plugins",
			"guide": "How to publish",
			"install.elapsed": "{seconds}s",
			"install.background": "Background",
			"install.terminate": "Cancel",
			"install.canceled": "Canceled",
			"toast.running": "Installing in background",
			"toast.done": "Installed",
			"toast.failed": "Install failed",
			"toast.canceled": "Canceled",
			"toast.restart": "Restart to apply",
			"toast.close.aria": "Dismiss"
		};
		//#endregion
		//#region src/client/index.ts
		/** Dictionary namespace owned by this plugin. */
		const NS = "pluginMarket";
		/** Services required by the sidebar footer-action and Settings tab registrations. */
		const inject = ["slots", "locale"];
		/** Register the market entry above Settings, the Plugins tab, and the dictionaries. */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "plugin-market: dictionaries");
			const t = ctx.locale.bind(NS);
			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "plugin-market",
				order: 50,
				locale: NS
			}, PluginMarketPanel));
			ctx.slots.inject("settings.plugins.tab", () => ctx.slots.register({
				name: "settings.plugins.tab",
				id: "market",
				order: 20,
				label: () => t("title"),
				locale: NS
			}, MarketSettingsTab));
		}
		//#endregion
		exports.NS = NS;
		exports.apply = apply;
		exports.inject = inject;
		return exports;
	}
});
