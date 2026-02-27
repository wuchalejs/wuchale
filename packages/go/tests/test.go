package tests

import (
	"fmt"
)

func foo() string {
	x := "Hello"
	fmt.Println("Hello")
	return x
}

func main() {
	fmt.Println(foo())
}
