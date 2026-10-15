/** Unicode math characters and their LaTeX commands (both directions use this table). */
export const SYMBOL_TO_LATEX: Record<string, string> = {
  α: "\\alpha", β: "\\beta", γ: "\\gamma", δ: "\\delta", ε: "\\epsilon", ϵ: "\\varepsilon", ζ: "\\zeta", η: "\\eta", θ: "\\theta", ϑ: "\\vartheta", ι: "\\iota", κ: "\\kappa", λ: "\\lambda", μ: "\\mu", ν: "\\nu", ξ: "\\xi", π: "\\pi", ϖ: "\\varpi", ρ: "\\rho", ϱ: "\\varrho", σ: "\\sigma", ς: "\\varsigma", τ: "\\tau", υ: "\\upsilon", φ: "\\phi", ϕ: "\\varphi", χ: "\\chi", ψ: "\\psi", ω: "\\omega",
  Γ: "\\Gamma", Δ: "\\Delta", Θ: "\\Theta", Λ: "\\Lambda", Ξ: "\\Xi", Π: "\\Pi", Σ: "\\Sigma", Υ: "\\Upsilon", Φ: "\\Phi", Ψ: "\\Psi", Ω: "\\Omega",
  "±": "\\pm", "∓": "\\mp", "×": "\\times", "÷": "\\div", "·": "\\cdot", "⋅": "\\cdot", "∗": "*", "≤": "\\leq", "≥": "\\geq", "≠": "\\neq", "≈": "\\approx", "≡": "\\equiv", "∼": "\\sim", "≃": "\\simeq", "≪": "\\ll", "≫": "\\gg", "∝": "\\propto",
  "∞": "\\infty", "∂": "\\partial", "∇": "\\nabla", "∈": "\\in", "∉": "\\notin", "∋": "\\ni", "⊂": "\\subset", "⊃": "\\supset", "⊆": "\\subseteq", "⊇": "\\supseteq", "∪": "\\cup", "∩": "\\cap", "∅": "\\emptyset", "∧": "\\wedge", "∨": "\\vee", "¬": "\\neg", "∀": "\\forall", "∃": "\\exists",
  "→": "\\to", "←": "\\leftarrow", "↔": "\\leftrightarrow", "⇒": "\\Rightarrow", "⇐": "\\Leftarrow", "⇔": "\\Leftrightarrow", "↦": "\\mapsto", "⟹": "\\implies", "⟺": "\\iff",
  "…": "\\ldots", "⋯": "\\cdots", "⋮": "\\vdots", "⋱": "\\ddots", "′": "'", "″": "''", "°": "^\\circ", "ℓ": "\\ell", "ℝ": "\\mathbb{R}", "ℕ": "\\mathbb{N}", "ℤ": "\\mathbb{Z}", "ℚ": "\\mathbb{Q}", "ℂ": "\\mathbb{C}", "ℏ": "\\hbar",
  "√": "\\sqrt", "∑": "\\sum", "∏": "\\prod", "∫": "\\int", "∬": "\\iint", "∭": "\\iiint", "∮": "\\oint", "⋃": "\\bigcup", "⋂": "\\bigcap", "∐": "\\coprod",
  "⟨": "\\langle", "⟩": "\\rangle", "⌊": "\\lfloor", "⌋": "\\rfloor", "⌈": "\\lceil", "⌉": "\\rceil", "‖": "\\|",
};

export const NARY_CHARS = new Set(["∑", "∏", "∫", "∬", "∭", "∮", "⋃", "⋂", "∐"]);

/** Functions typeset upright (\sin, \lim…). */
export const FUNCTION_NAMES = new Set(["sin", "cos", "tan", "cot", "sec", "csc", "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh", "log", "ln", "lg", "exp", "lim", "max", "min", "sup", "inf", "det", "dim", "ker", "gcd", "deg", "arg", "Pr"]);

export function charToLatex(text: string): string {
  let out = "";
  for (const ch of stripInvisible(text)) out += SYMBOL_TO_LATEX[ch] ? `${SYMBOL_TO_LATEX[ch]}${/[A-Za-z]$/.test(SYMBOL_TO_LATEX[ch]) ? " " : ""}` : ch === "{" ? "\\{" : ch === "}" ? "\\}" : ch === "%" ? "\\%" : ch === "&" ? "\\&" : ch === "#" ? "\\#" : ch === "$" ? "\\$" : ch === "_" ? "\\_" : ch;
  return out;
}

/** Delimiter character -> LaTeX for \left … \right. */
export function delimToLatex(ch: string | null): string {
  if (!ch) return ".";
  if (ch === "{") return "\\{";
  if (ch === "}") return "\\}";
  if (ch === "|" || ch === "(" || ch === ")" || ch === "[" || ch === "]") return ch;
  return SYMBOL_TO_LATEX[ch]?.trim() ?? ch;
}

/** Invisible operators MathML uses (function application, invisible times/separator/plus). */
export const INVISIBLE = /[\u2061\u2062\u2063\u2064]/g;
export const stripInvisible = (s: string) => s.replace(INVISIBLE, "");

/** Accent characters (spacing or combining) -> LaTeX accent command. */
export const ACCENT_TO_LATEX: Record<string, string> = {
  "^": "\\hat", "ˆ": "\\hat", "\u0302": "\\hat", "~": "\\tilde", "˜": "\\tilde", "\u0303": "\\tilde", "¯": "\\bar", "\u0304": "\\bar",
  "→": "\\vec", "\u20d7": "\\vec", "˙": "\\dot", "\u0307": "\\dot", "¨": "\\ddot", "\u0308": "\\ddot", "´": "\\acute", "`": "\\grave", "ˇ": "\\check", "˘": "\\breve",
};
export const OVERLINE_CHARS = new Set(["‾", "\u203e", "\u00af", "_", "\u0332", "\u0305"]);
