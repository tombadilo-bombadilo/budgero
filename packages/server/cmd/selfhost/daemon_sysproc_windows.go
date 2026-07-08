//go:build windows

package main

import "syscall"

func newSysProcAttr() *syscall.SysProcAttr {
	return nil
}
