import { useId, useState } from 'react';
import type { CSSProperties } from 'react';
import { useAuth } from '../lib/auth-store';
import './theme-lab.css';

type ThemeKey = 'xp' | 'vista' | 'gold';

const THEMES: Record<ThemeKey, { name: string; font: string; title: string }> = {
  xp: { name: 'XP-inspired', font: 'Tahoma', title: 'Rounded blue chrome' },
  vista: { name: 'Vista-inspired', font: 'Segoe UI', title: 'Translucent glass frame' },
  gold: { name: 'Gold picture frame', font: 'Georgia', title: 'Carved gilded picture frame' },
};

const FONTS: Record<string, string> = {
  'Pixelated MS Sans Serif': "'Pixelated MS Sans Serif','MS Sans Serif',Tahoma,sans-serif",
  Tahoma: "Tahoma,Verdana,'DejaVu Sans',sans-serif",
  'Segoe UI': "'Segoe UI','Helvetica Neue',Arial,sans-serif",
  Arial: "Arial,Helvetica,sans-serif",
  Georgia: "Georgia,'Times New Roman',serif",
  'Courier New': "'Courier New',Courier,monospace",
};

function Corner({ n }: { n: number }) {
  return (
    <svg className={`tl-deco tl-corner c${n}`} viewBox="0 0 46 46" aria-hidden="true">
      <path d="M3 43V10Q3 3 10 3H43" fill="none" stroke="#fbe9a0" strokeWidth="3" />
      <path d="M9 30Q9 9 30 9M14 24Q14 14 24 14" fill="none" stroke="#4a3005" strokeWidth="2" />
      <circle cx="12" cy="12" r="5" fill="#e9c453" stroke="#4a3005" strokeWidth="1.5" />
      <path d="M22 6Q28 12 34 6M6 22Q12 28 6 34" fill="none" stroke="#4a3005" strokeWidth="1.5" />
    </svg>
  );
}

function ThemeLabInner() {
  const radioGroup = useId();
  const [theme, setTheme] = useState<ThemeKey>('xp');
  const [fontSel, setFontSel] = useState('default');
  const [text, setText] = useState('Sample photo caption: sunrise over the harbor. Edit this demo text.');
  const [menu, setMenu] = useState<string | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [wide, setWide] = useState(false);
  const [count, setCount] = useState(0);
  const [check, setCheck] = useState(true);
  const [opt, setOpt] = useState('a');
  const [sampleInput, setSampleInput] = useState('Sample input');
  const [log, setLog] = useState('Preview only. Nothing here is saved.');

  const t = THEMES[theme];
  const family = fontSel === 'default' ? FONTS[t.font] : FONTS[fontSel];
  const style = { '--tl-pf': family } as CSSProperties;
  const say = (m: string) => { setLog(`Demo: ${m}`); setMenu(null); };
  const reset = () => { setFontSel('default'); setText('Sample photo caption: sunrise over the harbor. Edit this demo text.'); setSampleInput('Sample input'); setCount(0); setCheck(true); setOpt('a'); setMinimized(false); setWide(false); setMenu(null); setLog('Preview reset.'); };

  return (
    <div className="theme-lab" aria-label="Theme Lab" onDoubleClick={e => e.stopPropagation()} onKeyDown={e => {
      if (e.key === 'Escape' && menu) {
        e.currentTarget.querySelector<HTMLButtonElement>('[aria-expanded="true"]')?.focus();
        setMenu(null);
        e.stopPropagation();
      }
    }}>
      <div className="tl-scroll">
        <p className="tl-note">Admin-only preview. Changing theme or font here only affects the sample window below, not the desktop, the site, or other users. Nothing is saved.</p>
        <div className="tl-tabs" role="group" aria-label="Theme hypothesis">
          {(Object.keys(THEMES) as ThemeKey[]).map(k => (
            <button key={k} type="button" aria-pressed={theme === k} onClick={() => { setTheme(k); setMenu(null); }}>{THEMES[k].name}</button>
          ))}
        </div>
        <div className="tl-bar">
          <label>Preview font
            <select aria-label="Preview font" value={fontSel} onChange={e => setFontSel(e.target.value)}>
              <option value="default">Theme default ({t.font})</option>
              {Object.keys(FONTS).map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
          <button type="button" onClick={reset}>Reset preview</button>
        </div>
        <p className="tl-note" style={{ background: '#e8eef8', borderColor: '#4a5d80', color: '#14213d' }}>
          Fonts come from the viewer's installed system fonts; none are bundled. Tahoma and Segoe UI ship with Windows and may fall back to similar fonts on other systems. Pixelated MS Sans Serif is the app's existing web font.
        </p>

        <div className={`tl-stage ${theme}`}>
          <div className={`tl-win ${theme}`} style={{ ...style, maxWidth: wide ? 640 : 520 }} data-font={family}>
            {theme === 'gold' && [1, 2, 3, 4].map(n => <Corner key={n} n={n} />)}
            <div className="tl-title" onDoubleClick={() => setWide(w => !w)}>
              <span>{t.title} (preview)</span>
              <div className="tl-ctl">
                <button type="button" aria-label="Minimize sample body" onClick={() => setMinimized(m => !m)}>_</button>
                <button type="button" aria-label="Toggle sample width" onClick={() => setWide(w => !w)}>{wide ? '-' : '+'}</button>
                 <button type="button" title="Reset sample preview" aria-label="Reset preview (demo close)" onClick={reset}>x</button>
              </div>
            </div>
            {!minimized && (
              <>
                 <div className="tl-menu" role="group" aria-label="Sample menus">
                  {['File', 'Edit', 'View'].map(m => (
                    <div key={m}>
                       <button type="button" aria-expanded={menu === m} onClick={() => setMenu(menu === m ? null : m)}>{m}</button>
                      {menu === m && (
                         <div className="tl-drop" role="group" aria-label={`${m} demo options`}>
                           {['First item', 'Second item', 'Third item'].map(i => <button key={i} type="button" onClick={() => say(`${m} > ${i}`)}>{i}</button>)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <div className="tl-inner tl-body">
                  <span className="tl-tag">Demo content</span>
                  <label>Editable sample text
                    <textarea aria-label="Editable sample text" rows={3} value={text} onChange={e => setText(e.target.value)} />
                  </label>
                  <p style={{ margin: 0 }}>{text}</p>
                  <div className="tl-row">
                    <button type="button" className="tl-start" onClick={() => setCount(c => c + 1)}>Start demo ({count})</button>
                    <button type="button" onClick={() => say('Secondary button')}>Secondary</button>
                    <label><input type="checkbox" checked={check} onChange={e => setCheck(e.target.checked)} /> Option</label>
                     <label><input type="radio" name={`tl-opt-${radioGroup}`} checked={opt === 'a'} onChange={() => setOpt('a')} /> A</label>
                     <label><input type="radio" name={`tl-opt-${radioGroup}`} checked={opt === 'b'} onChange={() => setOpt('b')} /> B</label>
                  </div>
                   <input type="text" aria-label="Sample input" value={sampleInput} onChange={e => setSampleInput(e.target.value)} />
                  <div role="status" aria-live="polite" style={{ fontSize: '0.9em' }}>{log}</div>
                </div>
              </>
            )}
            {minimized && <div className="tl-inner tl-min">Body hidden. Use the minimize control to restore.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ThemeLab() {
  const isAdmin = useAuth(s => s.user)?.isAdmin;
  if (!isAdmin) {
    return (
      <div className="theme-lab">
        <div className="tl-lock" role="alert">Theme Lab is available to administrators only.</div>
      </div>
    );
  }
  return <ThemeLabInner />;
}
