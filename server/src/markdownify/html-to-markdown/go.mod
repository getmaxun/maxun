module html-to-markdown

go 1.23.0

toolchain go1.24.0

require (
	github.com/PuerkitoBio/goquery v1.10.3
	github.com/getmaxun/html-to-markdown/v2 v2.0.6
	golang.org/x/net v0.43.0
)

require (
	github.com/JohannesKaufmann/dom v0.2.0 // indirect
	github.com/andybalholm/cascadia v1.3.3 // indirect
)

replace github.com/JohannesKaufmann/html-to-markdown/v2 => github.com/getmaxun/html-to-markdown/v2 v2.0.0
