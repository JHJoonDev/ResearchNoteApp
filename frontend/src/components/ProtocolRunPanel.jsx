export default function ProtocolRunPanel({ run, editable, onChange, onSave, busy }) {
  if (!run?.snapshot) return null;
  const steps = run.snapshot.steps || [];
  const results = run.stepResults || [];
  const update = (step, changes) => {
    const current = results.find((result) => result.stepId === step.id) || { stepId: step.id, checked: [], values: {}, note: '' };
    onChange({
      ...run,
      stepResults: [
        ...results.filter((result) => result.stepId !== step.id),
        { ...current, ...changes },
      ],
    });
  };
  return (
    <section className="protocol-run-panel">
      <div className="card-header"><div><h3>프로토콜 실행</h3><p className="muted">{run.snapshot.title} · v{run.version}</p></div>{editable && <button className="btn-primary" disabled={busy} onClick={onSave}>{busy ? '저장 중…' : '실행 결과 저장'}</button>}</div>
      {steps.map((step, index) => {
        const result = results.find((entry) => entry.stepId === step.id) || { checked: [], values: {}, note: '' };
        return (
          <fieldset className="protocol-run-step" key={step.id}>
            <legend>{index + 1}. {step.title}</legend>
            {step.instructions && <p>{step.instructions}</p>}
            {!!step.checklist?.length && <div className="protocol-checklist">{step.checklist.map((item) => <label key={item.id}><input type="checkbox" disabled={!editable} checked={(result.checked || []).includes(item.id)} onChange={(e) => update(step, { checked: e.target.checked ? [...(result.checked || []), item.id] : result.checked.filter((id) => id !== item.id) })} />{item.text}</label>)}</div>}
            {!!step.resultFields?.length && <div className="protocol-result-fields">{step.resultFields.map((field) => <label key={field.id}>{field.name}{field.unit ? ` (${field.unit})` : ''}<input className="form-input" disabled={!editable} type={field.kind === 'number' ? 'number' : 'text'} value={result.values?.[field.id] ?? ''} onChange={(e) => {
              const values = { ...(result.values || {}) };
              if (field.kind === 'number') {
                if (e.target.value === '') delete values[field.id];
                else values[field.id] = Number(e.target.value);
              } else values[field.id] = e.target.value;
              update(step, { values });
            }} /></label>)}</div>}
            <label>단계 메모<textarea className="form-input" disabled={!editable} value={result.note || ''} onChange={(e) => update(step, { note: e.target.value })} /></label>
          </fieldset>
        );
      })}
    </section>
  );
}
