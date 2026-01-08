// $ cd .. && npm run test

package main

import (
	"fmt"
	"go/parser"
	"go/token"
	"go/ast"
	"os"
)

func main() {
	if len(os.Args) == 1 {
		fmt.Println("File required")
		return
	}
	filename := os.Args[1]
	fs := token.NewFileSet()
	node, err := parser.ParseFile(fs, filename, nil, parser.ParseComments)
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
