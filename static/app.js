/* PhytoState — progressive enhancement
   All routes keep working without JS (plain forms & links).
   With JS, fetches return the full page and #main is hot-swapped
   with a subtle exit/enter choreography. */

(() => {

    "use strict";

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

    async function apply(html) {
        const doc = new DOMParser().parseFromString(html, "text/html");
        const next = doc.getElementById("main");

        if (!next) {
            window.location.href = "/";   // unexpected response — full reload fallback
            return false;
        }

        const cur = main();

        // Subtle exit: small translateY, shorter than the entrance
        cur.querySelectorAll(".anim").forEach(el => el.style.removeProperty("--d"));
        cur.classList.add("swap-out");
        await sleep(150);

        cur.innerHTML = next.innerHTML;
        cur.classList.remove("swap-out");
        cur.classList.add("swap-in");
        stagger(cur);
        await raf2();
        cur.classList.remove("swap-in");

        window.setTimeout(() => {
            cur.querySelectorAll(".anim").forEach(el => el.style.removeProperty("--d"));
        }, 1000);

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
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const ok = await apply(await res.text());
            return ok;
        } catch (err) {
            toast("Request failed — is the Flask server running?", "bad");
            return null;
        } finally {
            window.clearTimeout(timeout);
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
        btn.setAttribute("aria-pressed", String(sim.on));
        $(".btn-label", btn).textContent = sim.on
            ? `Simulating ${Math.min(sim.tick + 1, ENGINE.STAGES.length)}/${ENGINE.STAGES.length}…`
            : "Simulate crop";
    }

    async function simTick() {
        if (!sim.on) return;

        const stage = ENGINE.STAGES[sim.tick % ENGINE.STAGES.length];
        const days = ENGINE.MIN[stage];
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
        if (sim.tick >= ENGINE.STAGES.length) {
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
        syncSimUI();
        (async () => {
            // Simulation always grows a fresh lifecycle — rewind first
            await request("/reset", {});
            if (sim.on) simTick();
        })();
    }

    function stopSim() {
        sim.on = false;
        if (sim.timer) window.clearTimeout(sim.timer);
        syncSimUI();
    }

    /* ------------------------------------------------------------------ */
    /* Delegated events (survive every content swap)                       */
    /* ------------------------------------------------------------------ */

    document.addEventListener("submit", e => {
        if (e.target.id === "predict-form") {
            e.preventDefault();
            submitPredict(e.target);
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

        const link = e.target.closest("a[data-route]");
        if (link) {
            e.preventDefault();
            followLink(link);
        }
    });

    document.addEventListener("change", e => {
        if (e.target.id === "image-input") showFile(e.target);
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
