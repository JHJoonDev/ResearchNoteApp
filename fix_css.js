const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, 'frontend/src/App.css');
let css = fs.readFileSync(cssPath, 'utf8');

// Replace specific backgrounds to use css vars
css = css.replace(/\.form-input\s*\{[^}]*background-color:\s*#F9FAFB;[^}]*\}/g, match => match.replace('background-color: #F9FAFB', 'background-color: var(--bg-color)'));
css = css.replace(/\.form-input:focus\s*\{[^}]*background-color:\s*white;[^}]*\}/g, match => match.replace('background-color: white', 'background-color: var(--surface-color)'));

css = css.replace(/\.modal-content\s*\{[^}]*background:\s*rgba\(255,\s*255,\s*255,\s*0\.85\);[^}]*\}/g, match => match.replace('background: rgba(255, 255, 255, 0.85)', 'background: var(--glass-bg)'));
css = css.replace(/\.modal-content\s*\{[^}]*border:\s*1px solid rgba\(255,\s*255,\s*255,\s*0\.4\);[^}]*\}/g, match => match.replace('border: 1px solid rgba(255, 255, 255, 0.4)', 'border: 1px solid var(--glass-border)'));

css = css.replace(/\.modal-footer\s*\{[^}]*background-color:\s*#F9FAFB;[^}]*\}/g, match => match.replace('background-color: #F9FAFB', 'background-color: var(--bg-color)'));

css = css.replace(/\.btn-secondary\s*\{[^}]*background-color:\s*white;[^}]*\}/g, match => match.replace('background-color: white', 'background-color: var(--surface-color)'));

css = css.replace(/\.editor-sidebar\s*\{[^}]*background-color:\s*#F8FAFC;[^}]*\}/g, match => match.replace('background-color: #F8FAFC', 'background-color: var(--bg-color)'));

css = css.replace(/\.ql-toolbar\.ql-snow\s*\{[^}]*background-color:\s*#F9FAFB;[^}]*\}/g, match => match.replace('background-color: #F9FAFB', 'background-color: var(--bg-color)'));

css = css.replace(/\.reagent-selector\s*\{[^}]*background-color:\s*#F8FAFC;[^}]*\}/g, match => match.replace('background-color: #F8FAFC', 'background-color: var(--bg-color)'));

css = css.replace(/\.reagent-tag\s*\{[^}]*background-color:\s*white;[^}]*\}/g, match => match.replace('background-color: white', 'background-color: var(--surface-color)'));

css = css.replace(/\.btn-icon\s*\{([^}]*)background:\s*white;([^}]*)\}/g, '.btn-icon {$1background: var(--surface-color);$2}');

fs.writeFileSync(cssPath, css);
console.log('App.css updated for dark mode backgrounds');
