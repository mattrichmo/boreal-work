import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode
} from "react";

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger";

export function cx(...parts: readonly (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: "primary" | "secondary" | "ghost" | "danger";
  readonly size?: "sm" | "md" | "lg";
  readonly icon?: ReactNode;
  readonly trailingIcon?: ReactNode;
}

export function Button({ variant = "secondary", size = "md", icon, trailingIcon, className, children, ...props }: ButtonProps) {
  return (
    <button className={cx("bw-button", `bw-button--${variant}`, `bw-button--${size}`, className)} {...props}>
      {icon ? <span className="bw-button__icon" aria-hidden="true">{icon}</span> : null}
      <span className="bw-button__label">{children}</span>
      {trailingIcon ? <span className="bw-button__icon" aria-hidden="true">{trailingIcon}</span> : null}
    </button>
  );
}

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  readonly tone?: Tone;
  readonly children: ReactNode;
}

export function Badge({ tone = "neutral", className, children, ...props }: BadgeProps) {
  return (
    <span className={cx("bw-badge", `bw-badge--${tone}`, className)} {...props}>
      {children}
    </span>
  );
}

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  readonly title?: ReactNode;
  readonly eyebrow?: ReactNode;
  readonly actions?: ReactNode;
}

export function Card({ title, eyebrow, actions, className, children, ...props }: CardProps) {
  return (
    <section className={cx("bw-card", className)} {...props}>
      {title || eyebrow || actions ? (
        <header className="bw-card__header">
          <div>
            {eyebrow ? <div className="bw-card__eyebrow">{eyebrow}</div> : null}
            {title ? <h3 className="bw-card__title">{title}</h3> : null}
          </div>
          {actions ? <div className="bw-card__actions">{actions}</div> : null}
        </header>
      ) : null}
      <div className="bw-card__body">{children}</div>
    </section>
  );
}

export interface FieldLabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  readonly hint?: ReactNode;
}

export function FieldLabel({ hint, className, children, ...props }: FieldLabelProps) {
  return (
    <label className={cx("bw-field-label", className)} {...props}>
      <span>{children}</span>
      {hint ? <span className="bw-field-label__hint">{hint}</span> : null}
    </label>
  );
}

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly label?: ReactNode;
  readonly error?: ReactNode;
}

export function TextInput({ label, error, id, className, ...props }: TextInputProps) {
  const inputId = id ?? props.name;
  return (
    <div className={cx("bw-field", className)}>
      {label && inputId ? <FieldLabel htmlFor={inputId}>{label}</FieldLabel> : null}
      <input id={inputId} className="bw-input" aria-invalid={Boolean(error) || undefined} {...props} />
      {error ? <div className="bw-field__error">{error}</div> : null}
    </div>
  );
}

export interface NoticeProps extends HTMLAttributes<HTMLDivElement> {
  readonly tone?: Tone;
  readonly label?: ReactNode;
}

export function Notice({ tone = "neutral", label, className, children, ...props }: NoticeProps) {
  return (
    <div className={cx("bw-notice", `bw-notice--${tone}`, className)} role={tone === "danger" ? "alert" : "status"} {...props}>
      {label ? <span className="bw-notice__label">{label}</span> : null}
      <div className="bw-notice__body">{children}</div>
    </div>
  );
}

export interface LoadingSkeletonProps extends HTMLAttributes<HTMLDivElement> {
  readonly lines?: number;
}

export function LoadingSkeleton({ lines = 3, className, ...props }: LoadingSkeletonProps) {
  return (
    <div className={cx("bw-skeleton", className)} aria-busy="true" {...props}>
      {Array.from({ length: lines }, (_, index) => (
        <span key={index} className="bw-skeleton__line" />
      ))}
    </div>
  );
}

export interface EntityChipProps extends HTMLAttributes<HTMLSpanElement> {
  readonly kind: string;
  readonly label: string;
}

export function EntityChip({ kind, label, className, ...props }: EntityChipProps) {
  return (
    <span className={cx("bw-entity-chip", className)} title={`${kind}: ${label}`} {...props}>
      <span className="bw-entity-chip__kind">{kind}</span>
      <span className="bw-entity-chip__label">{label}</span>
    </span>
  );
}

export interface MetricCardProps extends HTMLAttributes<HTMLDivElement> {
  readonly label: ReactNode;
  readonly value: ReactNode;
  readonly detail?: ReactNode;
  readonly tone?: Tone;
}

export function MetricCard({ label, value, detail, tone = "neutral", className, ...props }: MetricCardProps) {
  return (
    <div className={cx("bw-metric", `bw-metric--${tone}`, className)} {...props}>
      <div className="bw-metric__label">{label}</div>
      <div className="bw-metric__value">{value}</div>
      {detail ? <div className="bw-metric__detail">{detail}</div> : null}
    </div>
  );
}
