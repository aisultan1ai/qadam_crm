/**
 * Qadam CRM — Embed widget для форм захвата.
 *
 * Использование на любом сайте:
 *   <script src="https://your.qadam.host/embed.js" async></script>
 *   <div data-qadam-form="{tenant_slug}/{form_id}"
 *        data-theme="light|dark"          // опционально
 *        data-max-width="480px">           // опционально
 *   </div>
 *
 * Виджет:
 *   - тянет публичный конфиг GET /api/f/{slug}/{form_id}/config
 *   - рендерит форму в Shadow DOM (изоляция стилей от сайта)
 *   - honeypot-поле (website_url) — заполнят боты, мы отвергнем
 *   - submit → POST /api/f/{slug}/{form_id}
 */
(function () {
  "use strict";

  var scriptEl = document.currentScript || (function () {
    var scripts = document.getElementsByTagName("script");
    return scripts[scripts.length - 1];
  })();
  var API_ORIGIN = (scriptEl && scriptEl.src)
    ? new URL(scriptEl.src).origin
    : window.location.origin;

  function fetchJSON(url, opts) {
    return fetch(url, Object.assign({ credentials: "omit" }, opts || {}))
      .then(function (r) {
        return r.json().then(function (body) { return { ok: r.ok, status: r.status, body: body }; });
      });
  }

  function renderInput(field, brandColor) {
    var wrap = document.createElement("label");
    wrap.style.cssText = "display:block;margin-bottom:12px;font-family:inherit;";

    var span = document.createElement("span");
    span.textContent = field.label + (field.required ? " *" : "");
    span.style.cssText = "display:block;margin-bottom:4px;font-size:12px;font-weight:500;color:#555;";

    var el;
    if (field.type === "textarea") {
      el = document.createElement("textarea");
      el.rows = 3;
    } else if (field.type === "select") {
      el = document.createElement("select");
      (field.options || []).forEach(function (opt) {
        var o = document.createElement("option");
        o.value = opt;
        o.textContent = opt;
        el.appendChild(o);
      });
    } else {
      el = document.createElement("input");
      el.type = (
        field.type === "email" ? "email" :
        field.type === "phone" ? "tel" :
        field.type === "number" ? "number" : "text"
      );
    }
    el.name = field.key;
    el.required = !!field.required;
    if (field.placeholder) el.placeholder = field.placeholder;
    el.style.cssText =
      "width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #e5e5e5;" +
      "border-radius:8px;font-size:14px;font-family:inherit;background:#fff;color:#111;outline:none;";
    el.addEventListener("focus", function () { el.style.borderColor = brandColor; });
    el.addEventListener("blur", function () { el.style.borderColor = "#e5e5e5"; });

    wrap.appendChild(span);
    wrap.appendChild(el);
    return wrap;
  }

  function buildForm(container, config, submitUrl) {
    var host = document.createElement("div");
    host.style.cssText = "font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;";
    var maxWidth = container.getAttribute("data-max-width") || "480px";
    var theme = container.getAttribute("data-theme") || "light";
    var isDark = theme === "dark";
    var bg = isDark ? "#1e1e26" : "#ffffff";
    var fg = isDark ? "#eaeaea" : "#111";
    var muted = isDark ? "#aaa" : "#666";

    var shadow = container.attachShadow ? container.attachShadow({ mode: "open" }) : container;

    var card = document.createElement("div");
    card.style.cssText =
      "max-width:" + maxWidth + ";padding:24px;border-radius:14px;" +
      "border:1px solid " + (isDark ? "#333" : "#eee") + ";" +
      "background:" + bg + ";color:" + fg + ";box-shadow:0 2px 8px rgba(0,0,0,.04);";

    var title = document.createElement("h3");
    title.textContent = config.title;
    title.style.cssText = "margin:0 0 4px;font-size:18px;font-weight:600;";
    card.appendChild(title);

    if (config.subtitle) {
      var sub = document.createElement("p");
      sub.textContent = config.subtitle;
      sub.style.cssText = "margin:0 0 16px;font-size:13px;color:" + muted + ";";
      card.appendChild(sub);
    } else {
      card.appendChild(Object.assign(document.createElement("div"), { style: "height:12px;" }));
    }

    var form = document.createElement("form");
    form.noValidate = true;

    (config.fields_config || []).forEach(function (field) {
      form.appendChild(renderInput(field, config.brand_color));
    });

    // Honeypot: невидимое поле, боты заполняют — мы игнорируем.
    var hp = document.createElement("input");
    hp.type = "text";
    hp.name = "website_url";
    hp.tabIndex = -1;
    hp.autocomplete = "off";
    hp.setAttribute("aria-hidden", "true");
    hp.style.cssText = "position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;";
    form.appendChild(hp);

    var errorBox = document.createElement("div");
    errorBox.style.cssText = "display:none;margin-bottom:12px;padding:8px 12px;border-radius:8px;background:#fee;color:#c00;font-size:13px;";
    form.appendChild(errorBox);

    var submitBtn = document.createElement("button");
    submitBtn.type = "submit";
    submitBtn.textContent = config.submit_label || "Отправить";
    submitBtn.style.cssText =
      "width:100%;padding:12px 16px;border:none;border-radius:8px;" +
      "background:" + config.brand_color + ";color:#fff;font-size:14px;font-weight:500;" +
      "cursor:pointer;font-family:inherit;transition:opacity .15s;";

    form.appendChild(submitBtn);

    var successBox = document.createElement("div");
    successBox.style.cssText =
      "display:none;padding:20px;text-align:center;border-radius:8px;" +
      "background:" + (isDark ? "#0f2f22" : "#f0fdf4") + ";color:" + (isDark ? "#7ee5b3" : "#166534") + ";font-size:14px;";

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      errorBox.style.display = "none";
      submitBtn.disabled = true;
      submitBtn.style.opacity = "0.6";
      submitBtn.textContent = "Отправляем…";

      var data = {};
      var inputs = form.querySelectorAll("input, textarea, select");
      for (var i = 0; i < inputs.length; i++) {
        var el = inputs[i];
        if (el.name) data[el.name] = el.value;
      }

      fetchJSON(submitUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload: data }),
      })
        .then(function (res) {
          if (res.ok) {
            successBox.textContent = (res.body && res.body.message) || config.success_message;
            successBox.style.display = "block";
            form.style.display = "none";
            card.appendChild(successBox);
          } else {
            var msg = (res.body && (res.body.error && res.body.error.message || res.body.message)) || "Ошибка отправки";
            errorBox.textContent = msg;
            errorBox.style.display = "block";
            submitBtn.disabled = false;
            submitBtn.style.opacity = "1";
            submitBtn.textContent = config.submit_label || "Отправить";
          }
        })
        .catch(function () {
          errorBox.textContent = "Не удалось связаться с сервером. Попробуйте позже.";
          errorBox.style.display = "block";
          submitBtn.disabled = false;
          submitBtn.style.opacity = "1";
          submitBtn.textContent = config.submit_label || "Отправить";
        });
    });

    card.appendChild(form);

    var footer = document.createElement("div");
    footer.innerHTML =
      'Работает на <a href="' + API_ORIGIN + '" target="_blank" rel="noopener" ' +
      'style="color:' + muted + ';text-decoration:none;">Qadam CRM</a>';
    footer.style.cssText = "margin-top:14px;text-align:center;font-size:11px;color:" + muted + ";";
    card.appendChild(footer);

    host.appendChild(card);
    shadow.appendChild(host);
  }

  function mount(container) {
    if (container.__qadamMounted) return;
    container.__qadamMounted = true;

    var slug = container.getAttribute("data-qadam-form") || "";
    var parts = slug.split("/");
    if (parts.length !== 2) {
      console.warn("[qadam-embed] data-qadam-form must be 'tenant_slug/form_id', got:", slug);
      return;
    }
    var tenantSlug = parts[0];
    var formId = parts[1];

    var configUrl = API_ORIGIN + "/api/f/" + encodeURIComponent(tenantSlug) + "/" + encodeURIComponent(formId) + "/config";
    var submitUrl = API_ORIGIN + "/api/f/" + encodeURIComponent(tenantSlug) + "/" + encodeURIComponent(formId);

    fetchJSON(configUrl).then(function (res) {
      if (!res.ok) {
        container.textContent = "Форма недоступна";
        container.style.cssText = "padding:12px;color:#c00;font-family:inherit;";
        return;
      }
      buildForm(container, res.body, submitUrl);
    });
  }

  function mountAll() {
    var containers = document.querySelectorAll("[data-qadam-form]");
    for (var i = 0; i < containers.length; i++) mount(containers[i]);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountAll);
  } else {
    mountAll();
  }

  // Экспортируем для повторного mount (например, после SPA-навигации на странице клиента)
  window.QadamForms = { mountAll: mountAll };
})();
