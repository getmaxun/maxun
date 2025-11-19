package main

/*
#include <stdlib.h>
*/
import "C"

import (
	"strings"
	"unsafe"
	"unicode/utf8"

	"github.com/PuerkitoBio/goquery"
	md "github.com/getmaxun/html-to-markdown"
	"github.com/getmaxun/html-to-markdown/plugin"
	"golang.org/x/net/html"
)

//export ConvertHTMLToMarkdown
func ConvertHTMLToMarkdown(input *C.char) *C.char {
	// ConvertHTMLToMarkdown receives HTML and returns a markdown string allocated for C.
	engine := md.NewConverter("", true, nil)
	engine.Use(plugin.GitHubFlavored())

	registerPreHandler(engine)

	result, err := engine.ConvertString(C.GoString(input))
	if err != nil {
		// swallow conversion error (same as original)
	}

	return C.CString(result)
}

//export FreeCString
// Frees C string memory.
func FreeCString(str *C.char) {
	C.free(unsafe.Pointer(str))
}

func main() {
	// Required empty main for CGO.
}

// registerPreHandler configures a specialized PRE/code block rule
// to properly extract nested content and detect languages.
func registerPreHandler(conv *md.Converter) {
	isNoiseNode := func(class string) bool {
		l := strings.ToLower(class)
		return strings.Contains(l, "gutter") || strings.Contains(l, "line-numbers")
	}

	findLanguage := func(sel *goquery.Selection) string {
		cls := strings.ToLower(sel.AttrOr("class", ""))
		for _, chunk := range strings.Fields(cls) {
			if strings.HasPrefix(chunk, "language-") {
				return strings.TrimPrefix(chunk, "language-")
			}
			if strings.HasPrefix(chunk, "lang-") {
				return strings.TrimPrefix(chunk, "lang-")
			}
		}
		return ""
	}

	// Walk nodes and extract visible text, injecting newlines at block boundaries.
	var scrape func(n *html.Node, out *strings.Builder)
	scrape = func(n *html.Node, out *strings.Builder) {
		if n == nil {
			return
		}

		switch n.Type {
		case html.TextNode:
			out.WriteString(n.Data)

		case html.ElementNode:
			tag := strings.ToLower(n.Data)

			// skip gutter/line number elements
			for _, attr := range n.Attr {
				if attr.Key == "class" && isNoiseNode(attr.Val) {
					return
				}
			}

			if tag == "br" {
				out.WriteString("\n")
			}

			for child := n.FirstChild; child != nil; child = child.NextSibling {
				scrape(child, out)
			}

			switch tag {
			case "p", "div", "li", "tr", "table", "thead", "tbody", "tfoot",
				"section", "article", "blockquote", "pre",
				"h1", "h2", "h3", "h4", "h5", "h6":
				out.WriteString("\n")
			}
		}
	}

	// PRE blocks
	conv.AddRules(md.Rule{
		Filter: []string{"pre"},
		Replacement: func(_ string, s *goquery.Selection, opt *md.Options) *string {
			codeTag := s.Find("code").First()
			lang := findLanguage(codeTag)
			if lang == "" {
				lang = findLanguage(s)
			}

			var buf strings.Builder
			for _, node := range s.Nodes {
				scrape(node, &buf)
			}

			raw := strings.TrimRight(buf.String(), "\n")

			fRune, _ := utf8.DecodeRuneInString(opt.Fence)
			fence := md.CalculateCodeFence(fRune, raw)

			block := "\n\n" + fence + lang + "\n" + raw + "\n" + fence + "\n\n"
			return md.String(block)
		},
	})

	// Inline code rule
	conv.AddRules(md.Rule{
		Filter: []string{"code"},
		Replacement: func(_ string, s *goquery.Selection, opt *md.Options) *string {
			// do nothing when inside PRE
			if s.ParentsFiltered("pre").Length() > 0 {
				return nil
			}

			var buf strings.Builder
			for _, node := range s.Nodes {
				scrape(node, &buf)
			}

			text := md.TrimTrailingSpaces(strings.ReplaceAll(buf.String(), "\r\n", "\n"))

			fence := "`"
			if strings.Contains(text, "`") {
				fence = "``"
				if strings.Contains(text, "``") {
					fence = "```"
				}
			}

			inline := fence + text + fence
			return md.String(inline)
		},
	})
}
