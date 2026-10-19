# Your data

Lightkone has no accounts, no database of its own, no analytics and no ads.
The site serves the app. Your library lives in storage you choose, and the
app talks to it from your browser.

| What | Where it goes |
| --- | --- |
| Your papers, notes, highlights and PDFs | Only your own storage. The site never receives them, except when you use the AI app address (MCP): then the site's server reads your library from your storage for each request, with your storage keys sealed inside your private address. |
| Keys and tokens (Claude, GitHub, bucket, OpenAlex) | Only this browser's settings. Each is sent only to the service it belongs to. Invite links never carry them. |
| Ask, Explain, Summarize and Cite this's check | When you use them, your question and the passages picked from your papers go from your browser straight to Anthropic, with your own Claude key. |
| Adding and looking up papers | The DOI, arXiv id or title goes to Crossref, OpenAlex, Semantic Scholar or arXiv. For open-access PDFs, the DOI and your contact email go to Unpaywall through the site. |
| Related papers and the citation map | The DOIs or arXiv ids of your papers go to OpenAlex or Semantic Scholar. |
| New on arXiv | Only the categories you follow go to arXiv, through the site. The ranking happens in your browser. |
| Search by equation | Each arXiv id goes to the site, which fetches that paper's public LaTeX source from arXiv and returns its equations. |

The site's few server functions exist only where browsers aren't allowed to
call a service directly (arXiv listings and sources, open-access PDFs,
published versions, and the MCP address). They keep nothing; public answers
from arXiv are cached for a while. The host (Cloudflare) keeps its usual
request logs.

The same table is in the app, under **Help → Your data**.
