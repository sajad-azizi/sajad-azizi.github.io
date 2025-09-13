    (function () {
    const btn = document.getElementById('theme-toggle');


    function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    }


    function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('theme', theme); } catch (e) {}
    btn.setAttribute('aria-pressed', theme === 'dark');
    btn.textContent = theme === 'dark' ? '☀️ Light' : '🌙 Dark';
    }


    btn.addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    });


    // Set the correct initial button label and aria-pressed
    applyTheme(currentTheme());
    })();