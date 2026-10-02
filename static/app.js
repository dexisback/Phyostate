/* PhytoState — progressive enhancement
   All routes keep working without JS (plain forms & links).
   With JS, fetches return the full page and #main is hot-swapped
   with a subtle exit/enter choreography. */

(() => {

    "use strict";

    // Lets CSS hide no-JS fallback affordances (e.g. the profile "Apply" button)
    document.documentElement.classList.add("js");

    const $ = (sel, root = document) => root.querySelector(sel);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sleep = ms => new Promise(r => setTimeout(r, reduced.matches ? 0 : ms));
    const raf2 = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    const main = () => document.getElementById("main");

    /* Mirror of automaton.py constants (static engine config) */
    const ENGINE = {
        STAGES: ["SEED", "GERMINATION", "VEGETATIVE", "FLOWERING", "FRUITING", "HARVEST"],
        MIN: { SEED: 1, GERMINATION: 2, VEGETATIVE: 3, FLOWERING: 2, FRUITING: 3, HARVEST: 0 },
        BOUNDS: {
            SEED: [1, 3],
            GERMINATION: [2, 5],
            VEGETATIVE: [3, 8],
            FLOWERING: [2, 5],
            FRUITING: [3, 7],
            HARVEST: [0, 0]
        }
    };

    const sim = { on: false, tick: 0, timer: null };

    let lastMs = 0;

    const events = [];

    const ROUTE_LABELS = {
        "/demo/skip": "Stage Skipping",
        "/demo-backward": "Backward Transition",
        "/demo/premature": "Premature Transition",
        "/demo/stagnation": "Abnormal Stagnation",
        "/demo/valid": "Healthy Cycle"
    };

    const doneRoutes = new Set();
    let busyEl = null;
    let runningSuite = false;

    /* ------------------------------------------------------------------ */
    /* Rendering swaps                                                     */
    /* ------------------------------------------------------------------ */

    function stagger(root) {
        const items = root.querySelectorAll(".anim");
        items.forEach((el, i) => {
            if (!reduced.matches) {
                el.style.setProperty("--d", `${Math.min(i * 60, 360)}ms`);
            }
        });
        return items;
    }

    function swapContent(cur, next) {
        cur.innerHTML = next.innerHTML;
    }

    async function apply(html) {
        const doc = new DOMParser().parseFromString(html, "text/html");
        const next = doc.getElementById("main");

        if (!next) {
            window.location.href = "/";   // unexpected response — full reload fallback
            return false;
        }

        const cur = main();

        if (document.startViewTransition && !reduced.matches) {
            // Buttery crossfade via the View Transitions API (Chromium)
            const vt = document.startViewTransition(() => swapContent(cur, next));
            await vt.finished.catch(() => {});
        } else {
            // Fallback: subtle exit, then staggered entrance
            cur.querySelectorAll(".anim").forEach(el => el.style.removeProperty("--d"));
            cur.classList.add("swap-out");
            await sleep(150);

            swapContent(cur, next);
            cur.classList.remove("swap-out");
            cur.classList.add("swap-in");
            stagger(cur);
            await raf2();
            cur.classList.remove("swap-in");

            window.setTimeout(() => {
                cur.querySelectorAll(".anim").forEach(el => el.style.removeProperty("--d"));
            }, 1000);
        }

        const banner = $(".banner", cur);
        if (banner) {
            window.scrollTo({ top: 0, behavior: reduced.matches ? "instant" : "smooth" });
            banner.focus({ preventScroll: true });  // announce result to screen readers
        }

        // Re-apply "run" badges across swapped content
        doneRoutes.forEach(route => {
            document.querySelectorAll(`[data-route="${CSS.escape(route)}"]`)
                .forEach(el => el.classList.add("done"));
        });

        postRender();
        return true;
    }

    /* ------------------------------------------------------------------ */
    /* Requests                                                            */
    /* ------------------------------------------------------------------ */

    async function request(url, { method = "GET", body, el } = {}) {
        if (busyEl) return null;

        const t0 = performance.now();
        const wasBusy = el;
        if (el) {
            busyEl = el;
            el.classList.add("busy");
            el.setAttribute("aria-busy", "true");
        }

        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 15000);

        try {
            const res = await fetch(url, { method, body, signal: controller.signal });
            window.clearTimeout(timeout);
            if (!res.ok) {
                let message = `HTTP ${res.status}`;
                try {
                    const body = await res.json();
                    if (body && body.error) message = body.error;
                } catch (err) {
                    /* non-JSON error page — keep the status code */
                }
                throw new Error(message);
            }
            const ok = await apply(await res.text());
            return ok;
        } catch (err) {
            toast(err && err.message ? err.message : "Request failed — is the Flask server running?", "bad");
            return null;
        } finally {
            window.clearTimeout(timeout);
            lastMs = Math.round(performance.now() - t0);
            if (wasBusy) {
                busyEl = null;
                wasBusy.classList.remove("busy");
                wasBusy.removeAttribute("aria-busy");
            }
        }
    }

    async function followLink(link) {
        const route = link.dataset.route || link.getAttribute("href");
        const ok = await request(link.getAttribute("href"), { el: link });
        if (ok && route) {
            doneRoutes.add(route);
            link.classList.add("done");
            const label = ROUTE_LABELS[route];
            if (label) {
                const verdict = readVerdict();
                addEvent(verdict.kind, `Scenario: ${label} — ${verdict.text}`);
            } else if (route === "/reset") {
                addEvent("info", "Session reset — lifecycle cleared");
            }
        }
    }

    async function submitPredict(form) {
        if (sim.on) {
            toast("Stop the crop simulation first.", "info");
            return;
        }
        if (!form.reportValidity()) return;

        const btn = form.querySelector('button[type="submit"]');
        const label = btn.querySelector(".btn-label");
        const original = label.textContent;

        btn.disabled = true;
        btn.classList.add("loading");
        label.textContent = "Analyzing…";

        const ok = await request(form.action, {
            method: "POST",
            body: new FormData(form),
            el: null   // busy handled via the disabled submit button above
        });

        // If the swap failed, restore the button so the user can retry.
        if (ok === null) {
            btn.disabled = false;
            btn.classList.remove("loading");
            label.textContent = original;
            return;
        }

        if (ok) {
            const pred = readPrediction();
            if (pred.stage) {
                addEvent("ok", `Predicted ${pred.stage}${pred.conf ? ` · ${pred.conf}` : ""} · ${lastMs} ms`);
            } else {
                addEvent("bad", `Photo rejected by classifier · ${lastMs} ms`);
            }
        }
    }

    /* ------------------------------------------------------------------ */
    /* Scenario suite                                                      */
    /* ------------------------------------------------------------------ */

    async function runAll(btn) {
        if (runningSuite) return;
        if (sim.on) {
            toast("Stop the crop simulation first.", "info");
            return;
        }
        runningSuite = true;

        const label = btn.querySelector(".btn-label");
        const original = label.textContent;
        btn.classList.add("busy");
        btn.setAttribute("aria-busy", "true");
        label.textContent = "Running…";
        addEvent("info", "Running full scenario suite…");

        for (const route of [
            "/demo/skip",
            "/demo-backward",
            "/demo/premature",
            "/demo/stagnation",
            "/demo/valid"
        ]) {
            const link = document.querySelector(`a[data-route="${CSS.escape(route)}"]`);
            if (link) {
                await followLink(link);
            } else {
                await request(route, {});
            }
            await sleep(420);
        }

        btn.classList.remove("busy");
        btn.removeAttribute("aria-busy");
        label.textContent = original;
        runningSuite = false;
    }

    /* ------------------------------------------------------------------ */
    /* Form helpers                                                        */
    /* ------------------------------------------------------------------ */

    let previewURL = null;

    function showFile(input) {
        const zone = input.closest(".dropzone");
        const file = input.files && input.files[0];
        if (!zone || !file) return;

        if (previewURL) URL.revokeObjectURL(previewURL);
        previewURL = URL.createObjectURL(file);

        const img = $("#preview-img", zone);
        const name = $("#file-name", zone);
        const size = $("#file-size", zone);

        img.src = previewURL;
        name.textContent = file.name;
        size.textContent = file.size > 1048576
            ? `${(file.size / 1048576).toFixed(1)} MB`
            : `${Math.max(1, Math.round(file.size / 1024))} KB`;

        // Class drives visibility (see CSS .dropzone.has-file rules)
        zone.classList.add("has-file");
    }

    function stepValue(btn) {
        const input = btn.parentElement.querySelector("input");
        if (!input) return;
        const value = (parseInt(input.value, 10) || 0) + Number(btn.dataset.step);
        input.value = Math.min(99, Math.max(0, value));
    }

    /* ------------------------------------------------------------------ */
    /* Toast                                                               */
    /* ------------------------------------------------------------------ */

    let toastTimer = null;

    function toast(message, kind = "info") {
        const el = $("#toast");
        if (!el) return;
        $("#toast-msg").textContent = message;
        el.dataset.kind = kind;
        el.classList.add("show");
        window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(() => el.classList.remove("show"), 3200);
    }

    /* ------------------------------------------------------------------ */
    /* Client-side verdict rendering                                       */
    /* ------------------------------------------------------------------ */

    function readData() {
        try {
            const node = document.getElementById("phyto-data");
            if (node) return JSON.parse(node.textContent);
        } catch (err) {
            /* malformed island — fall through to engine defaults */
        }
        return { sequence: [], durations: [], bounds: ENGINE.BOUNDS };
    }

    /* Parse engine messages and light up the offending transitions:
       flagged states in the automaton diagram + timeline, red arrows
       along each forbidden path, tinted rows in the dwell ledger. */
    function applyFlags() {
        const messages = [...document.querySelectorAll(".banner-msgs li")]
            .map(li => li.textContent);
        if (!messages.length) return;

        const flagged = new Set();
        const pairs = [];

        for (const m of messages) {
            const t = m.match(/([A-Z]+) → ([A-Z]+)/);
            if (t) {
                flagged.add(t[1]);
                flagged.add(t[2]);
                pairs.push([t[1], t[2]]);
            }
            const p = m.match(/Premature transition: ([A-Z]+)/);
            if (p) flagged.add(p[1]);
            const s = m.match(/Abnormal stagnation: ([A-Z]+)/);
            if (s) flagged.add(s[1]);
            if (m.includes("not reached HARVEST")) {
                const seq = readData().sequence || [];
                if (seq.length) flagged.add(seq[seq.length - 1]);
            }
        }
        if (!flagged.size) return;

        const states = [...document.querySelectorAll(".dfa-state")];
        states.forEach(st => {
            if (flagged.has($(".dfa-name", st).textContent.trim())) {
                st.classList.add("is-flagged");
            }
        });

        const arrows = [...document.querySelectorAll(".dfa-arrow")];
        pairs.forEach(([a, b]) => {
            const ia = states.findIndex(st => $(".dfa-name", st).textContent.trim() === a);
            const ib = states.findIndex(st => $(".dfa-name", st).textContent.trim() === b);
            if (ia < 0 || ib < 0) return;
            const lo = Math.min(ia, ib), hi = Math.max(ia, ib);
            for (let k = lo; k < hi; k++) {
                if (arrows[k]) arrows[k].classList.add("is-flagged");
            }
        });

        document.querySelectorAll(".tl-node").forEach(n => {
            if (flagged.has($(".tl-name", n).textContent.trim())) {
                n.classList.add("tl-flagged");
            }
        });

        document.querySelectorAll("tbody tr").forEach(tr => {
            const pill = tr.querySelector(".pill-bad, .pill-warn");
            if (pill) {
                tr.classList.add(pill.classList.contains("pill-bad") ? "row-bad" : "row-warn");
            }
        });
    }

    /* Dwell-time Gantt: observed bars drawn against allowed min–max windows. */
    function renderGantt() {
        const holder = document.getElementById("gantt");
        if (!holder) return;

        const data = readData();
        const seq = data.sequence || [];
        const durs = data.durations || [];
        const bounds = data.bounds || {};
        holder.innerHTML = "";

        if (!seq.length) return;

        const total = durs.reduce((a, b) => a + b, 0);
        const scale = total > 0 ? total : 1;
        const step = scale > 14 ? 2 : 1;

        const rows = document.createDocumentFragment();
        let cum = 0;

        seq.forEach((stage, i) => {
            const d = durs[i] || 0;
            const [lo, hi] = bounds[stage] || [0, 0];

            const row = document.createElement("div");
            row.className = "gantt-row";

            const label = document.createElement("span");
            label.className = "gantt-label";
            label.textContent = stage;

            const track = document.createElement("div");
            track.className = "gantt-track";

            for (let k = step; k < scale; k += step) {
                const line = document.createElement("i");
                line.style.left = `${(k / scale) * 100}%`;
                track.appendChild(line);
            }

            if (hi > lo) {
                const band = document.createElement("div");
                band.className = "gantt-band";
                band.style.left = `${((cum + lo) / scale) * 100}%`;
                band.style.width = `${((hi - lo) / scale) * 100}%`;
                band.title = `${stage} allowed window: ${lo}–${hi} d`;
                track.appendChild(band);
            }

            const bar = document.createElement("div");
            bar.className = "gantt-bar";
            if (stage !== "HARVEST") {
                if (d < lo) bar.classList.add("st-bad");
                else if (d > hi) bar.classList.add("st-warn");
            }
            bar.style.left = `${(cum / scale) * 100}%`;
            bar.style.width = `${(d / scale) * 100}%`;
            bar.style.minWidth = "2px";
            bar.title = `${stage}: observed ${d} day(s) · allowed ${lo}–${hi} d`;
            track.appendChild(bar);

            row.appendChild(label);
            row.appendChild(track);
            rows.appendChild(row);
            cum += d;
        });

        const axis = document.createElement("div");
        axis.className = "gantt-row";
        const axisLabel = document.createElement("span");
        axisLabel.className = "gantt-label";
        axisLabel.textContent = "days";
        const axisTrack = document.createElement("div");
        axisTrack.className = "gantt-axis-track";
        for (let k = 0; k <= scale; k += step) {
            const tick = document.createElement("b");
            tick.style.left = `${(k / scale) * 100}%`;
            tick.textContent = k;
            axisTrack.appendChild(tick);
        }
        axis.appendChild(axisLabel);
        axis.appendChild(axisTrack);
        rows.appendChild(axis);

        holder.appendChild(rows);
    }

    function postRender() {
        applyFlags();
        renderGantt();
        syncSimUI();
        renderLog();
    }

    /* ------------------------------------------------------------------ */
    /* Camera simulation — fast-forwards a full lifecycle                  */
    /* ------------------------------------------------------------------ */

    function sensorFrame(stage, days) {
        const svg =
            `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="0 0 480 360">` +
            `<rect width="480" height="360" fill="#0a0a0a"/>` +
            `<rect x="14" y="14" width="452" height="332" fill="none" stroke="rgba(255,255,255,0.18)" stroke-dasharray="8 8"/>` +
            `<text x="240" y="170" font-family="ui-monospace,monospace" font-size="30" fill="#ededed" text-anchor="middle">${stage}</text>` +
            `<text x="240" y="206" font-family="ui-monospace,monospace" font-size="18" fill="#a1a1a1" text-anchor="middle">+${days}d</text>` +
            `<text x="30" y="46" font-family="ui-monospace,monospace" font-size="13" fill="#707070">PHYTOSTATE · SIMULATED FIELD CAMERA</text>` +
            `<text x="30" y="330" font-family="ui-monospace,monospace" font-size="13" fill="#707070">frame ${String(sim.tick + 1).padStart(2, "0")}</text>` +
            `</svg>`;
        return new Blob([svg], { type: "image/svg+xml" });
    }

    function syncSimUI() {
        const btn = document.getElementById("sim-toggle");
        if (!btn) return;
        const data = readData();
        const stagesLen = (data.profile && data.profile.stages)
            ? data.profile.stages.length
            : ENGINE.STAGES.length;
        btn.setAttribute("aria-pressed", String(sim.on));
        $(".btn-label", btn).textContent = sim.on
            ? `Simulating ${Math.min(sim.tick + 1, stagesLen)}/${stagesLen}…`
            : "Simulate crop";
    }

    async function simTick() {
        if (!sim.on) return;

        // The active crop profile drives the simulation: its stages and
        // minimum dwell times come straight from the rendered data island.
        const data = readData();
        const stages = (data.profile && data.profile.stages) || ENGINE.STAGES;
        const bounds = data.bounds || ENGINE.BOUNDS;

        const stage = stages[sim.tick % stages.length];
        const days = (bounds[stage] || [1, 0])[0];
        syncSimUI();

        const fd = new FormData();
        fd.append("image", sensorFrame(stage, days), `sim-${stage.toLowerCase()}-${sim.tick}.svg`);
        fd.append("duration", String(days));

        const ok = await request("/predict", { method: "POST", body: fd });
        if (ok === null) {
            // Request failed or superseded — retry the same stage on the next tick
            if (sim.on) sim.timer = window.setTimeout(simTick, 2200);
            return;
        }

        sim.tick++;
        if (!sim.on) return;
        if (sim.tick >= stages.length) {
            stopSim();
            return;
        }
        sim.timer = window.setTimeout(simTick, 2200);
    }

    function toggleSim() {
        if (sim.on) {
            stopSim();
            return;
        }
        if (busyEl) return;
        sim.on = true;
        sim.tick = 0;
        addEvent("info", "Camera simulation started");
        syncSimUI();
        (async () => {
            // Simulation always grows a fresh lifecycle — rewind first
            await request("/reset", {});
            if (sim.on) simTick();
        })();
    }

    function stopSim() {
        if (sim.on) addEvent("info", "Camera simulation stopped");
        sim.on = false;
        if (sim.timer) window.clearTimeout(sim.timer);
        syncSimUI();
    }

    async function submitProfile(form) {
        if (!form) return;
        if (sim.on) stopSim();          // switching crop aborts any running simulation
        const ok = await request("/profile", { method: "POST", body: new FormData(form) });
        if (ok) {
            const select = form.querySelector("select");
            const name = (select && select.selectedOptions && select.selectedOptions[0])
                ? select.selectedOptions[0].text
                : "new crop";
            addEvent("info", `Crop profile → ${name} · lifecycle reset`);
        }
    }

    /* ------------------------------------------------------------------ */
    /* Session log, verdict reader, report dialog, capability actions      */
    /* ------------------------------------------------------------------ */

    const escapeHtml = s => String(s).replace(/[&<>"']/g, c => (
        { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));

    function addEvent(kind, text) {
        events.unshift({ time: new Date(), kind, text });
        if (events.length > 40) events.pop();
        renderLog();
    }

    function renderLog() {
        const card = document.getElementById("log-card");
        const list = document.getElementById("event-list");
        if (!card || !list) return;
        list.innerHTML = "";
        if (!events.length) {
            card.classList.add("is-hidden");
            return;
        }
        card.classList.remove("is-hidden");
        for (const ev of events) {
            const li = document.createElement("li");
            li.className = `event kind-${ev.kind}`;
            const t = document.createElement("span");
            t.className = "event-time";
            t.textContent = ev.time.toTimeString().slice(0, 8);
            const dot = document.createElement("i");
            const tx = document.createElement("span");
            tx.textContent = ev.text;
            li.append(t, dot, tx);
            list.appendChild(li);
        }
    }

    function readVerdict() {
        const banner = $(".banner");
        if (!banner) return { kind: "info", text: "no verdict rendered" };
        const headline = ($(".banner-title", banner) || {}).textContent || "";
        if (banner.classList.contains("banner-ok")) {
            const pred = readPrediction();
            return { kind: "ok", text: pred.stage ? `verified · ${pred.stage}` : "verified" };
        }
        return { kind: "bad", text: headline.trim() || "rejected" };
    }

    function readPrediction() {
        const chips = [...document.querySelectorAll(".banner-top .chip")]
            .map(c => c.textContent.trim());
        const stage = chips.find(t => t.startsWith("Model output:"));
        const conf = chips.find(t => /^\d+% · /.test(t));
        return {
            stage: stage ? stage.replace("Model output:", "").trim() : null,
            conf: conf || null
        };
    }

    async function openReport() {
        const dlg = document.getElementById("report-dialog");
        if (!dlg) return;
        try {
            const res = await fetch("/export?format=json");
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            renderReport(dlg, data);
            dlg.showModal();
        } catch (err) {
            toast(err && err.message ? err.message : "Could not load report", "bad");
        }
    }

    function renderReport(dlg, data) {
        const body = $("#report-body", dlg);
        if (!body) return;
        const verdict = data.verdict || {};
        const ok = !!verdict.valid;
        const rows = (data.observations || []).map(o => {
            const terminal = o.allowed[0] === 0 && o.allowed[1] === 0;
            return `<tr>
                <td class="tabular">${o.index + 1}</td>
                <td>${escapeHtml(o.stage)}</td>
                <td class="num tabular">${o.days} d</td>
                <td class="num tabular">${terminal ? "—" : `${o.allowed[0]}–${o.allowed[1]} d`}</td>
            </tr>`;
        }).join("");
        const msgs = (verdict.messages || []).map(m => `<li>${escapeHtml(m)}</li>`).join("");

        body.innerHTML = `
            <div class="report-meta">
                <span class="pill ${ok ? "pill-ok" : "pill-bad"}">${ok ? "VERIFIED" : "REJECTED"}</span>
                <span class="chip">${escapeHtml((data.profile || {}).name || "")} profile</span>
                <span class="chip tabular">${(data.observations || []).length} observations</span>
                <span class="chip">${escapeHtml(data.predictor_mode || "")} predictor</span>
            </div>
            ${rows
                ? `<div class="table-wrap"><table>
                    <thead><tr><th>#</th><th>Stage</th><th class="num">Days</th><th class="num">Allowed</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table></div>`
                : `<p class="report-empty">No observations logged.</p>`}
            <ul class="banner-msgs">${msgs}</ul>
            <p class="report-stamp">Generated ${escapeHtml(String(data.generated_at || "")).replace("T", " ").slice(0, 19)} UTC</p>
        `;
    }

    function spotlight(el) {
        if (!el) return;
        el.classList.add("spotlight");
        window.setTimeout(() => el.classList.remove("spotlight"), 1400);
    }

    function performAction(action) {
        switch (action) {
            case "simulate":
                toggleSim();
                break;
            case "focus-upload": {
                const input = document.getElementById("image-input");
                if (input) {
                    input.focus();
                    input.closest(".card")?.scrollIntoView({
                        behavior: reduced.matches ? "instant" : "smooth",
                        block: "start"
                    });
                }
                break;
            }
            case "goto-dfa":
            case "goto-ledger": {
                const heading = document.getElementById(action === "goto-dfa" ? "h-dfa" : "h-dwell");
                const card = heading && heading.closest(".card");
                if (card) {
                    card.scrollIntoView({ behavior: reduced.matches ? "instant" : "smooth", block: "start" });
                    spotlight(card);
                }
                break;
            }
            case "run-suite":
                $("#run-all")?.click();
                break;
            case "reset":
                request("/reset", {});
                break;
            case "report":
                openReport();
                break;
        }
    }

    /* ------------------------------------------------------------------ */
    /* Delegated events (survive every content swap)                       */
    /* ------------------------------------------------------------------ */

    document.addEventListener("submit", e => {
        if (e.target.id === "predict-form") {
            e.preventDefault();
            submitPredict(e.target);
            return;
        }
        if (e.target.id === "profile-form") {
            e.preventDefault();
            submitProfile(e.target);
        }
    });

    document.addEventListener("click", e => {
        const stepper = e.target.closest("[data-step]");
        if (stepper) {
            stepValue(stepper);
            return;
        }

        if (e.target.closest("#run-all")) {
            runAll(e.target.closest("#run-all"));
            return;
        }

        if (e.target.closest("#sim-toggle")) {
            toggleSim();
            return;
        }

        if (e.target.closest("#copy-curl")) {
            const cmd = `curl -F "image=@photo.jpg" -F "duration=2" ${window.location.origin}/predict`;
            navigator.clipboard.writeText(cmd).then(() => {
                toast("cURL command copied to clipboard");
                addEvent("info", "Copied /predict as a cURL command");
            }).catch(() => toast("Clipboard unavailable", "bad"));
            return;
        }

        const exportLink = e.target.closest('a[href*="/export?format="]');
        if (exportLink && !exportLink.closest("#report-dialog")) {
            addEvent("info", `Report exported (${exportLink.href.endsWith("md") ? ".md" : ".json"})`);
            // no preventDefault — the download proceeds natively
        }

        const actionEl = e.target.closest("[data-action]");
        if (actionEl) {
            performAction(actionEl.dataset.action);
            return;
        }

        const link = e.target.closest("a[data-route]");
        if (link) {
            e.preventDefault();
            followLink(link);
        }
    });

    document.addEventListener("change", e => {
        if (e.target.id === "image-input") showFile(e.target);
        if (e.target.id === "profile-select") submitProfile(e.target.form);
    });

    document.addEventListener("keydown", e => {
        if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;

        const tag = (e.target.tagName || "").toLowerCase();
        if (tag === "input" || tag === "select" || tag === "textarea" || e.target.isContentEditable) return;

        const dlg = document.getElementById("report-dialog");
        if (dlg && dlg.open) return;   // Escape is handled natively by the dialog

        const k = e.key.toLowerCase();

        if (k >= "1" && k <= "5") {
            const card = document.querySelectorAll(".demo")[Number(k) - 1];
            if (card) {
                e.preventDefault();
                followLink(card);
            }
        } else if (k === "s") {
            e.preventDefault();
            toggleSim();
        } else if (k === "r") {
            e.preventDefault();
            request("/reset", {});
        } else if (k === "a") {
            e.preventDefault();
            const input = document.getElementById("image-input");
            if (input) {
                input.focus();
                input.closest(".card")?.scrollIntoView({
                    behavior: reduced.matches ? "instant" : "smooth",
                    block: "start"
                });
            }
        } else if (k === "d") {
            e.preventDefault();
            openReport();
        } else if (k === "e") {
            e.preventDefault();
            addEvent("info", "Report exported (.md)");
            window.location.href = "/export?format=md";
        }
    });

    document.addEventListener("dragover", e => {
        const zone = e.target.closest(".dropzone");
        if (zone) e.preventDefault();
    });

    document.addEventListener("dragleave", e => {
        const zone = e.target.closest(".dropzone");
        if (zone) zone.classList.remove("drag");
    });

    document.addEventListener("drop", e => {
        const zone = e.target.closest(".dropzone");
        if (!zone) return;
        e.preventDefault();
        zone.classList.remove("drag");

        const input = zone.querySelector('input[type="file"]');
        const file = [...e.dataTransfer.files].find(f => f.type.startsWith("image/"));
        if (!input || !file) return;

        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        showFile(input);
    });

    /* ------------------------------------------------------------------ */
    /* One-time bindings (dialog lives outside #main — survives swaps)     */
    /* ------------------------------------------------------------------ */

    const reportDialog = document.getElementById("report-dialog");

    if (reportDialog) {
        reportDialog.addEventListener("click", e => {
            if (e.target === reportDialog) reportDialog.close();   // backdrop click
        });
        $("#report-close", reportDialog)?.addEventListener("click", () => reportDialog.close());
    }

    /* ------------------------------------------------------------------ */
    /* Boot entrance                                                       */
    /* ------------------------------------------------------------------ */

    const cur = main();
    if (cur) {
        cur.classList.add("swap-in");
        stagger(cur);
        raf2().then(() => {
            cur.classList.remove("swap-in");
            postRender();
            window.setTimeout(() => {
                cur.querySelectorAll(".anim").forEach(el => el.style.removeProperty("--d"));
            }, 1000);
        });
    }

})();
