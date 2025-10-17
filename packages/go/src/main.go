// $ go run %f

package main

import (
	"fmt"
	"go/parser"
	"go/token"
	"go/ast"
)

func main() {
	fs := token.NewFileSet()
	node, err := parser.ParseFile(fs, "main.go", nil, parser.ParseComments)
	if err != nil {
		fmt.Println("error", err)
	}
	for _, decl := range node.Decls {
		switch d := decl.(type) {
		case *ast.GenDecl:
			fmt.Println("general", d)
		case *ast.FuncDecl:
			fmt.Println("func", d)
		default:
			fmt.Println("def", d)
		}
	}
}
