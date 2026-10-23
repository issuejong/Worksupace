export function AnswerOptions({ options, selected, onSelect }: { options: string[]; selected: string; onSelect?: (value: string) => void }) {
  return <div className="option-grid" role={onSelect ? "group" : "list"} aria-label="선택지">{options.map((option, index) => {
    const content = <><span className="option-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span><span className="option-text">{option}</span></>;
    const selectedClass = selected === option ? " selected" : "";
    return onSelect
      ? <button type="button" className={`option${selectedClass}`} key={`${index}-${option}`} aria-pressed={selected === option} onClick={() => onSelect(option)}>{content}</button>
      : <div className={`option option-readonly${selectedClass}`} role="listitem" key={`${index}-${option}`}>{content}{selected === option && <span className="small">제출한 답안</span>}</div>;
  })}</div>;
}
