/* Diagnóstico Digital Gratuito — comportamento da landing page (menu, animações de entrada, FAQ e formulário). */
(function () {
  "use strict";
  var d = document, root = d.documentElement, T0 = Date.now();
  var $ = function (s, c) { return (c || d).querySelector(s); }, $$ = function (s, c) { return Array.prototype.slice.call((c || d).querySelectorAll(s)); };
  root.classList.add("x-js");

  // Eventos de conversão: usa a medição que o site já tiver carregada (gtag). Não cria nenhuma integração nova.
  function track(name, params) { try { if (typeof window.gtag === "function") window.gtag("event", name, params || {}); } catch (e) {} }

  /* cabeçalho e menus */
  var head = $("#xhead"), onScroll = function () { if (head) head.classList.toggle("scrolled", window.scrollY > 8); };
  onScroll(); window.addEventListener("scroll", onScroll, { passive: true });
  var burger = $(".x-burger"), mnav = $("#xmnav");
  function menu(open) { if (!burger || !mnav) return; mnav.hidden = !open; burger.setAttribute("aria-expanded", String(open)); burger.setAttribute("aria-label", open ? "Fechar menu" : "Abrir menu"); root.classList.toggle("x-lock", open); }
  function dd(open) { var li = $(".x-dd"), b = $(".x-ddb"); if (!li || !b) return; li.classList.toggle("open", open); b.setAttribute("aria-expanded", String(open)); }
  d.addEventListener("click", function (e) {
    var t = e.target.closest ? e.target.closest("[data-v3]") : null;
    if (!t) { if (!e.target.closest || !e.target.closest(".x-dd")) dd(false); if (e.target.closest && e.target.closest("#xmnav a")) menu(false); return; }
    var k = t.getAttribute("data-v3");
    if (k === "menu") menu(mnav.hidden);
    else if (k === "dd") dd(t.getAttribute("aria-expanded") !== "true");
    else if (k === "macc") { var p = $("#xmacc"), o = t.getAttribute("aria-expanded") === "true"; t.setAttribute("aria-expanded", String(!o)); if (p) p.hidden = o; }
    else if (k === "faq") { var op = t.getAttribute("aria-expanded") === "true"; t.setAttribute("aria-expanded", String(!op)); t.closest(".x-qa").classList.toggle("open", !op); if (!op) track("diagnostico_faq", { pergunta: t.textContent.trim().slice(0, 80) }); }
  });
  d.addEventListener("keydown", function (e) { if (e.key !== "Escape") return; if ($(".x-dd.open")) { dd(false); $(".x-ddb").focus(); } if (mnav && !mnav.hidden) { menu(false); burger.focus(); } });

  /* entrada suave das secções */
  var rv = $$(".x-rv");
  if ("IntersectionObserver" in window && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    var io = new IntersectionObserver(function (es) { es.forEach(function (x) { if (x.isIntersecting) { x.target.classList.add("in"); io.unobserve(x.target); } }); }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    rv.forEach(function (el) { io.observe(el); });
    setTimeout(function () { rv.forEach(function (el) { el.classList.add("in"); }); }, 4000); // rede de segurança
  } else rv.forEach(function (el) { el.classList.add("in"); });

  /* botões «Pedir diagnóstico gratuito» */
  $$("[data-dd-cta]").forEach(function (a) {
    a.addEventListener("click", function (e) {
      var sec = $("#pedido"); if (!sec) return;
      e.preventDefault(); track("diagnostico_cta_click", { local: a.getAttribute("data-dd-cta") });
      sec.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      var f = $("#dd-nome"); if (f) setTimeout(function () { f.focus({ preventScroll: true }); }, 500);
      if (history.replaceState) history.replaceState(null, "", "#pedido");
    });
  });

  /* formulário */
  var form = $("#dd-form"); if (!form) return;
  var btn = $("#dd-send"), ferr = $("#dd-err"), live = $("#dd-live"), started = false;
  var F = ["nome", "email", "marca", "url", "desafio", "privacidade"];
  var el = function (n) { return form.elements[n]; };
  var val = function (n) { return String(el(n).value || "").trim(); };
  var RULES = {
    nome: function () { return val("nome").length < 2 ? "Escreve o teu nome." : ""; },
    email: function () { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val("email")) ? "" : "Escreve um email válido para eu te poder responder."; },
    marca: function () { return val("marca").length < 2 ? "Escreve o nome do teu negócio." : ""; },
    url: function () { var v = val("url"); if (!v) return "Indica o teu website ou o teu Instagram."; return /^@?[A-Za-z0-9._]{2,30}$/.test(v) || /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(\/\S*)?$/i.test(v) ? "" : "O endereço não parece válido. Escreve, por exemplo, omeunegocio.pt ou @omeunegocio."; },
    desafio: function () { return val("desafio").length < 10 ? "Conta-me, em poucas palavras, o que gostavas de melhorar." : ""; },
    privacidade: function () { return el("privacidade").checked ? "" : "Para enviar o pedido, confirma que leste a Política de Privacidade."; }
  };
  function show(n, msg) {
    var i = el(n), e = $("#dd-e-" + n); if (!i || !e) return;
    e.textContent = msg || "";
    if (msg) i.setAttribute("aria-invalid", "true"); else i.removeAttribute("aria-invalid");
  }
  F.forEach(function (n) {
    var i = el(n);
    i.addEventListener(n === "privacidade" ? "change" : "blur", function () { if (n === "privacidade" || val(n)) show(n, RULES[n]()); });
    i.addEventListener("input", function () { if (!started) { started = true; track("diagnostico_form_start"); } if (i.getAttribute("aria-invalid")) show(n, RULES[n]()); });
  });
  function busy(on) { form.classList.toggle("is-busy", on); btn.disabled = on; btn.setAttribute("aria-busy", String(on)); $("span", btn).textContent = on ? "A enviar o teu pedido…" : "Quero o meu diagnóstico gratuito"; if (on) live.textContent = "A enviar o teu pedido…"; }
  function fail(msg) { ferr.textContent = msg; live.textContent = ""; busy(false); }
  function success(dup) {
    var box = $("#dd-ok");
    if (dup) { $("h3", box).textContent = "Já tenho o teu pedido."; $("p", box).textContent = "Este pedido já tinha sido recebido, por isso não precisas de o enviar outra vez. Vou analisar as informações que enviaste e entrar em contacto contigo."; }
    form.hidden = true; box.hidden = false; box.focus();
    box.scrollIntoView({ block: "center", behavior: "auto" });
    track(dup ? "diagnostico_pedido_repetido" : "generate_lead", dup ? {} : { lead_type: "diagnostico_digital" });
  }
  form.addEventListener("submit", function (e) {
    e.preventDefault(); if (btn.disabled) return;
    ferr.textContent = "";
    var first = null;
    F.forEach(function (n) { var m = RULES[n](); show(n, m); if (m && !first) first = el(n); });
    if (first) { first.focus(); live.textContent = "Há campos por corrigir no formulário."; track("diagnostico_form_erro"); return; }
    busy(true);
    var body = { nome: val("nome"), email: val("email"), marca: val("marca"), url: val("url"), desafio: val("desafio"), privacidade: true, "bot-field": el("bot-field").value, t: Date.now() - T0 };
    var ctl = "AbortController" in window ? new AbortController() : null, timer = setTimeout(function () { if (ctl) ctl.abort(); }, 20000);
    fetch("/api/diagnostico", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ctl ? ctl.signal : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, j: j }; }); })
      .then(function (r) {
        clearTimeout(timer);
        // só mostra «Pedido recebido» quando o servidor confirma que o pedido ficou guardado
        if (r.ok && r.j && r.j.ok === true && r.j.id) { busy(false); success(!!r.j.duplicate); return; }
        if (r.j && r.j.fields) { var f1 = null; Object.keys(r.j.fields).forEach(function (n) { if (el(n)) { show(n, r.j.fields[n]); if (!f1) f1 = el(n); } }); if (f1) f1.focus(); }
        fail((r.j && r.j.error) || "Não foi possível enviar o pedido. Tenta outra vez daqui a pouco ou escreve-me para beatrizmachadostudio@gmail.com.");
      })
      .catch(function () { clearTimeout(timer); fail("Não consegui ligar ao servidor. Confirma a tua ligação à internet e tenta outra vez. O teu pedido ainda não foi enviado."); });
  });
})();
