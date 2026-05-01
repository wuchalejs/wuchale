import 'acorn'

// very important because the AST from @sveltejs/acorn-typescript doesn't agree with @types/estree-jsx
declare module 'acorn' {
    interface TSAsExpression extends Node {
      type: "TSAsExpression"
      expression: Expression
    }
    interface TSTypeAssertion extends Node {
      type: "TSTypeAssertion"
      expression: Expression
    }
    interface TSSatisfiesExpression extends Node {
      type: "TSSatisfiesExpression"
      expression: Expression
    }
}
