"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CrawlStrategy = void 0;
// Define crawl strategy types
var CrawlStrategy;
(function (CrawlStrategy) {
    CrawlStrategy["BFS"] = "bfs";
    CrawlStrategy["DFS"] = "dfs";
    CrawlStrategy["BEST_FIRST"] = "best_first"; // Best-First Search
})(CrawlStrategy || (exports.CrawlStrategy = CrawlStrategy = {}));
