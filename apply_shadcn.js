const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, 'frontend/src/App.css');
let css = fs.readFileSync(cssPath, 'utf8');

// Font replacement
css = css.replace(/font-family:\s*'Inter'/g, "font-family: 'Pretendard Variable', Pretendard");

// Modifying variables
css = css.replace(/--primary-color:\s*#2563EB;/, "--primary-color: #0F172A; /* Shadcn Dark Slate Primary */");
css = css.replace(/--primary-color-hover:\s*#1D4ED8;/, "--primary-color-hover: #1E293B;");
css = css.replace(/--text-main:\s*#0F172A;/, "--text-main: #020617;");
css = css.replace(/--text-muted:\s*#64748B;/, "--text-muted: #64748B;");
css = css.replace(/--bg-color:\s*#F8FAFC;/, "--bg-color: #F8FAFC; /* Light gray bg */");
css = css.replace(/--shadow-md:([^;]+);/g, "--shadow-md: 0 10px 15px -3px rgba(0, 0, 0, 0.05), 0 4px 6px -4px rgba(0, 0, 0, 0.05);");
css = css.replace(/--shadow-lg:([^;]+);/g, "--shadow-lg: 0 25px 50px -12px rgba(0, 0, 0, 0.25);");
css = css.replace(/--shadow-sm:([^;]+);/g, "--shadow-sm: 0 1px 3px 0 rgba(0, 0, 0, 0.08), 0 1px 2px -1px rgba(0, 0, 0, 0.08);");

// Component updates
// Card
css = css.replace(/\.card\s*\{([^}]*)\}/, (match, p1) => {
    return `.card {${p1.replace(/border-radius:\s*[^\n;]+;/, "border-radius: 24px;").replace(/padding:\s*[^\n;]+;/, "padding: 2rem;").replace(/box-shadow:\s*[^\n;]+;/, "box-shadow: var(--shadow-md);")} }`;
});

// KPI Card
css = css.replace(/\.kpi-card\s*\{([^}]*)\}/, (match, p1) => {
    return `.kpi-card {${p1.replace(/border-radius:\s*[^\n;]+;/, "border-radius: 20px;").replace(/padding:\s*[^\n;]+;/, "padding: 1.5rem;").replace(/box-shadow:\s*[^\n;]+;/, "box-shadow: var(--shadow-sm);")} }`;
});

// Form input
css = css.replace(/\.form-input\s*\{([^}]*)\}/, (match, p1) => {
    return `.form-input {${p1.replace(/border-radius:\s*[^\n;]+;/, "border-radius: 12px;").replace(/padding:\s*[^\n;]+;/, "padding: 0.8rem 1rem; border: 2px solid var(--border-color); outline: none; transition: border-color 0.2s, box-shadow 0.2s; background-color: var(--bg-color);").replace(/font-size:\s*[^\n;]+;/, "font-size: 0.95rem; font-weight: 500;")} }`;
});

// Buttons
const btns = ['\\.btn-primary', '\\.btn-secondary', '\\.btn-outline', '\\.editor-save-btn', '\\.btn-block'];
btns.forEach(btn => {
    css = css.replace(new RegExp(`${btn}\\s*\\{([^}]*)\\}`), (match, p1) => {
        return `${btn.replace('\\', '')} {${p1.replace(/border-radius:\s*[^\n;]+;/, "border-radius: 9999px;").replace(/font-weight:\s*[^\n;]+;/, "font-weight: 700;").replace(/font-weight/.test(p1) ? '' : 'font-size:', "font-weight: 700;\n  font-size:")} }`;
    });
});

// Login Card
css = css.replace(/\.login-card\s*\{([^}]*)\}/, (match, p1) => {
    return `.login-card {${p1.replace(/border-radius:\s*[^\n;]+;/, "border-radius: 32px;").replace(/padding:\s*[^\n;]+;/, "padding: 3rem 2.5rem;").replace(/box-shadow:\s*[^\n;]+;/, "box-shadow: var(--shadow-lg);")} }`;
});

fs.writeFileSync(cssPath, css);
console.log('Shadcn style CSS applied!');
