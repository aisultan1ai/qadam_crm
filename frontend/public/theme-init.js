(function () {
  try {
    var stored = localStorage.getItem("theme");
    var prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    var isDark = stored === "dark" || (!stored && prefersDark);
    if (isDark) document.documentElement.classList.add("dark");
  } catch (e) {}
})();
