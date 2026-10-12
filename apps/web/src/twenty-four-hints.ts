type Fraction = { n: bigint; d: bigint };
type Node = { value: Fraction; text: string; steps: string[] };
function gcd(a: bigint, b: bigint): bigint { let x = a < 0n ? -a : a; let y = b < 0n ? -b : b; while (y) [x, y] = [y, x % y]; return x || 1n; }
function fraction(n: bigint, d = 1n): Fraction { if (!d) throw new Error('division by zero'); const sign = d < 0n ? -1n : 1n; const g = gcd(n, d); return { n: sign * n / g, d: sign * d / g }; }
function format(value: Fraction): string { return value.d === 1n ? String(value.n) : `${value.n}/${value.d}`; }
function operand(value: Fraction): string { const text = format(value); return value.d !== 1n || value.n < 0n ? `(${text})` : text; }

// Solver output is fully parenthesized. Parse only that narrow grammar; never evaluate source text.
export function solutionSteps(expression: string): string[] {
  if (expression.length > 128) throw new Error('invalid solution');
  let at = 0;
  function parse(): Node {
    if (expression[at] !== '(') {
      const start = at;
      while (/[0-9]/.test(expression[at] ?? '')) at++;
      if (at === start) throw new Error('invalid solution');
      const text = expression.slice(start, at);
      return { value: fraction(BigInt(text)), text, steps: [] };
    }
    at++;
    const left = parse();
    const operator = expression[at++];
    const right = parse();
    if (expression[at++] !== ')' || !['+', '-', '*', '/'].includes(operator ?? '')) throw new Error('invalid solution');
    const a = left.value, b = right.value;
    const value = operator === '+' ? fraction(a.n * b.d + b.n * a.d, a.d * b.d)
      : operator === '-' ? fraction(a.n * b.d - b.n * a.d, a.d * b.d)
        : operator === '*' ? fraction(a.n * b.n, a.d * b.d)
          : fraction(a.n * b.d, a.d * b.n);
    const visibleOperator = operator === '*' ? '×' : operator === '/' ? '÷' : operator === '-' ? '−' : operator;
    const step = `${operand(a)} ${visibleOperator} ${operand(b)} = ${format(value)}`;
    return { value, text: expression.slice(0, at), steps: [...left.steps, ...right.steps, step] };
  }
  const parsed = parse();
  if (at !== expression.length || parsed.steps.length !== 3 || parsed.value.n !== 24n * parsed.value.d) throw new Error('invalid solution');
  return parsed.steps;
}
