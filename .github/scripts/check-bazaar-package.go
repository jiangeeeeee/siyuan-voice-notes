// Run inside an official siyuan-note/bazaar checkout to reuse its actual rules.
package main

import (
	"encoding/json"
	"os"

	"github.com/siyuan-note/bazaar/rules"
)

func main() {
	if len(os.Args) != 4 { panic("usage: check-bazaar-package ROOT ZIP OWNER/REPO") }
	data, err := os.ReadFile(os.Args[2])
	if err != nil { panic(err) }
	result := rules.Check(rules.Input{
		PackageRoot: os.Args[1], ZipData: data, OwnerRepo: os.Args[3],
		Type: rules.TypePlugin, OldName: "siyuan-voice-notes", OldVersion: "0.8.2",
	})
	json.NewEncoder(os.Stdout).Encode(map[string]any{"OK": result.OK, "Issues": result.Issues})
	if !result.OK { os.Exit(1) }
}
