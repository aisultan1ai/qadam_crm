/**
 * HTML письма в изолированном iframe: стили рассылки (<style>, width="800") не протекают в интерфейс CRM.
 * sandbox без allow-scripts — скрипты не выполняются даже если что-то пропустит серверная очистка
 * (backend/app/core/html_sanitize.py). allow-same-origin нужен только чтобы родитель мог измерить высоту.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useTheme } from "@/store/theme";

function buildDoc(html: string, dark: boolean): string {
  const fg = dark ? "#E6E7EA" : "#1B1D22";
  const link = dark ? "#8FB3FA" : "#2456C7";
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data: cid:; style-src 'unsafe-inline'; font-src https: data:">
<base target="_blank">
<style>
  html,body{margin:0;padding:0;background:transparent;color:${fg};}
  body{font:14px/1.55 Inter,"Segoe UI",system-ui,sans-serif;word-wrap:break-word;overflow-wrap:anywhere;}
  img,video{max-width:100%!important;height:auto!important;}
  table{max-width:100%!important;}
  a{color:${link};}
  pre{white-space:pre-wrap;}
  blockquote{margin:0 0 0 .5em;padding-left:.75em;border-left:2px solid ${dark ? "#2A2E36" : "#E5E7EB"};}
</style></head><body>${html}</body></html>`;
}

export function SafeHtmlFrame({ html, title = "Содержимое письма" }: { html: string; title?: string }) {
  const { theme } = useTheme();
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);
  const srcDoc = useMemo(() => buildDoc(html, theme === "dark"), [html, theme]);

  const measure = useCallback(() => {
    const doc = ref.current?.contentDocument;
    if (!doc?.documentElement) return;
    setHeight(Math.min(Math.max(doc.documentElement.scrollHeight, 40), 20000));
  }, []);

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    let ro: ResizeObserver | undefined;
    const onLoad = () => {
      measure();
      const body = frame.contentDocument?.body;
      if (body && "ResizeObserver" in window) {
        ro = new ResizeObserver(measure);
        ro.observe(body);
      }
      // Картинки догружаются после load — перемеряем.
      frame.contentDocument?.querySelectorAll("img").forEach((img) => img.addEventListener("load", measure, { once: true }));
    };
    frame.addEventListener("load", onLoad);
    return () => {
      frame.removeEventListener("load", onLoad);
      ro?.disconnect();
    };
  }, [srcDoc, measure]);

  return (
    <iframe
      ref={ref}
      title={title}
      srcDoc={srcDoc}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      className="block w-full border-0"
      style={{ height }}
    />
  );
}
