// API Integration Module for Real-Debrid and Trakt
class APIManager {
    constructor() {
        this.rdBaseUrl = 'https://api.real-debrid.com/rest/1.0';
        this.traktBaseUrl = 'https://api.trakt.tv';
        this.rdApiKey = null;
        // Load Trakt Client ID from localStorage or use empty string
        this.traktClientId = localStorage.getItem('traktClientId') || '';
        this.traktAccessToken = null;
        
        // Multiple CORS proxy services with fallback
        this.corsProxies = [
            'https://api.allorigins.win/raw?url=',
            'https://cors-anywhere.herokuapp.com/',
            'https://thingproxy.freeboard.io/fetch/',
            'https://corsproxy.org/?',
            'https://cors.eu.org/',
            'https://yacdn.org/proxy/'
        ];
        this.currentProxyIndex = 0;
        this.corsProxy = this.corsProxies[this.currentProxyIndex];
        
        // Quality hierarchy for upgrades (higher index = better quality)
        this.qualityHierarchy = ['480p', '720p', '1080p', '2160p', '4K', 'UHD'];
    }

    // Method to try the next CORS proxy when current one fails
    async tryNextProxy() {
        this.currentProxyIndex = (this.currentProxyIndex + 1) % this.corsProxies.length;
        this.corsProxy = this.corsProxies[this.currentProxyIndex];
        console.log(`Switching to CORS proxy: ${this.corsProxy}`);
    }

    // Enhanced fetch method with automatic proxy fallback
    async fetchWithFallback(url, options = {}, maxRetries = 3) {
        let lastError = null;
        const originalProxyIndex = this.currentProxyIndex;
        
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const proxyUrl = `${this.corsProxy}${encodeURIComponent(url)}`;
                console.log(`Attempt ${attempt + 1}: Using proxy ${this.corsProxy}`);
                
                const response = await fetch(proxyUrl, {
                    ...options,
                    headers: {
                        ...options.headers,
                        'X-Requested-With': 'XMLHttpRequest'
                    }
                });

                // If response is ok, return it
                if (response.ok) {
                    return response;
                }
                
                // If response indicates CORS/proxy issue, try next proxy
                if (response.status >= 400) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                
                return response;
            } catch (error) {
                console.error(`Proxy ${this.corsProxy} failed:`, error.message);
                lastError = error;
                
                // Try next proxy for next attempt
                if (attempt < maxRetries - 1) {
                    await this.tryNextProxy();
                }
            }
        }
        
        // Reset to original proxy if all failed
        this.currentProxyIndex = originalProxyIndex;
        this.corsProxy = this.corsProxies[this.currentProxyIndex];
        
        throw new Error(`All CORS proxies failed. Last error: ${lastError?.message || 'Unknown error'}`);
    }

    // Method to update the client ID when it's saved
    updateTraktClientId(clientId) {
        this.traktClientId = clientId;
    }

    // Real-Debrid Methods
    async testRealDebridConnection(apiKey) {
        try {
            const response = await this.fetchWithFallback(`${this.rdBaseUrl}/user`, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const userData = await response.json();
                return { success: true, data: userData };
            } else {
                return { success: false, error: 'Invalid API key' };
            }
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async addMagnetToRealDebrid(apiKey, magnetLink) {
        try {
            // First, add the magnet
            const addResponse = await this.fetchWithFallback(`${this.rdBaseUrl}/torrents/addMagnet`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: `magnet=${encodeURIComponent(magnetLink)}`
            });

            if (addResponse.ok) {
                const addResult = await addResponse.json();
                
                // If successful, select all files
                if (addResult.id) {
                    await this.selectAllFiles(apiKey, addResult.id);
                }
                
                return { success: true, data: addResult };
            } else {
                return { success: false, error: 'Failed to add magnet' };
            }
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async selectAllFiles(apiKey, torrentId) {
        try {
            // Get torrent info to select all files
            const infoResponse = await this.fetchWithFallback(`${this.rdBaseUrl}/torrents/info/${torrentId}`, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`
                }
            });

            if (infoResponse.ok) {
                const torrentInfo = await infoResponse.json();
                const fileIds = torrentInfo.files.map((_, index) => index + 1).join(',');
                
                // Select all files
                await this.fetchWithFallback(`${this.rdBaseUrl}/torrents/selectFiles/${torrentId}`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    body: `files=${fileIds}`
                });
            }
        } catch (error) {
            console.error('Error selecting files:', error);
        }
    }

    async getRealDebridTorrents(apiKey) {
        try {
            const response = await this.fetchWithFallback(`${this.rdBaseUrl}/torrents`, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`
                }
            });

            if (response.ok) {
                const torrents = await response.json();
                return { success: true, data: torrents };
            } else {
                return { success: false, error: 'Failed to get torrents' };
            }
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async getRealDebridDownloads(apiKey, limit = 50) {
        try {
            const response = await this.fetchWithFallback(`${this.rdBaseUrl}/downloads?limit=${limit}`, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`
                }
            });

            if (response.ok) {
                const downloads = await response.json();
                return { success: true, data: downloads };
            } else {
                return { success: false, error: 'Failed to get downloads' };
            }
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // Trakt Methods
    async getTraktWatchlist(accessToken, type = 'movies') {
        try {
            const response = await this.fetchWithFallback(`${this.traktBaseUrl}/sync/watchlist/${type}`, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'trakt-api-version': '2',
                    'trakt-api-key': this.traktClientId,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const watchlist = await response.json();
                return { success: true, data: watchlist };
            } else {
                return { success: false, error: 'Failed to get watchlist' };
            }
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async addToTraktWatchlist(accessToken, item, type = 'movies') {
        try {
            const payload = {
                [type]: [item]
            };

            const response = await this.fetchWithFallback(`${this.traktBaseUrl}/sync/watchlist`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'trakt-api-version': '2',
                    'trakt-api-key': this.traktClientId,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                const result = await response.json();
                return { success: true, data: result };
            } else {
                return { success: false, error: 'Failed to add to watchlist' };
            }
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async searchTraktContent(query, type = 'movie') {
        try {
            const response = await this.fetchWithFallback(`${this.traktBaseUrl}/search/${type}?query=${encodeURIComponent(query)}`, {
                headers: {
                    'trakt-api-version': '2',
                    'trakt-api-key': this.traktClientId,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const results = await response.json();
                return { success: true, data: results };
            } else {
                return { success: false, error: 'Search failed' };
            }
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // Hash List Processing
    async processHashListForMatching(hashListContent, preferences) {
        const lines = hashListContent.split('\n');
        const processed = [];

        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed && this.isMagnetLink(trimmed)) {
                const metadata = this.extractMetadataFromMagnet(trimmed);
                if (this.matchesPreferences(metadata, preferences)) {
                    processed.push({
                        magnet: trimmed,
                        title: metadata.title,
                        quality: metadata.quality,
                        size: metadata.size,
                        type: metadata.type
                    });
                }
            }
        }

        return processed;
    }

    isMagnetLink(text) {
        return text.startsWith('magnet:?xt=urn:btih:');
    }

    extractMetadataFromMagnet(magnetLink) {
        const params = new URLSearchParams(magnetLink.split('?')[1]);
        const displayName = params.get('dn') || '';
        
        return {
            title: this.cleanTitle(displayName),
            quality: this.extractQuality(displayName),
            size: this.extractSize(displayName),
            type: this.detectContentType(displayName),
            hdr: this.extractHDRInfo(displayName),
            codec: this.extractCodec(displayName)
        };
    }

    cleanTitle(title) {
        // Remove common release group tags and quality indicators
        return title
            .replace(/\[.*?\]/g, '')
            .replace(/\(.*?\)/g, '')
            .replace(/\d{4}p?/g, '')
            .replace(/BluRay|WEB-DL|WEBRip|HDRip|BRRip/gi, '')
            .replace(/x264|x265|HEVC/gi, '')
            .trim();
    }

    extractQuality(title) {
        const qualityMatch = title.match(/(\d{3,4}p)|4K|UHD/i);
        return qualityMatch ? qualityMatch[0] : 'Unknown';
    }

    extractSize(title) {
        const sizeMatch = title.match(/(\d+(?:\.\d+)?)\s*(GB|MB)/i);
        return sizeMatch ? `${sizeMatch[1]} ${sizeMatch[2]}` : 'Unknown';
    }

    detectContentType(title) {
        if (/S\d{2}E\d{2}|Season|Episode/i.test(title)) {
            return 'tv';
        }
        return 'movie';
    }

    extractHDRInfo(title) {
        const hdrTypes = {
            dolbyVision: /dolby.?vision|dv/i.test(title),
            hdr10Plus: /hdr10\+/i.test(title),
            hdr10: /hdr10(?!\+)/i.test(title),
            hdr: /\bhdr\b/i.test(title) && !/hdr10/i.test(title)
        };

        if (hdrTypes.dolbyVision) return 'Dolby Vision';
        if (hdrTypes.hdr10Plus) return 'HDR10+';
        if (hdrTypes.hdr10) return 'HDR10';
        if (hdrTypes.hdr) return 'HDR';
        
        return 'SDR'; // Standard Dynamic Range
    }

    extractCodec(title) {
        if (/x265|hevc|h\.?265/i.test(title)) return 'HEVC';
        if (/x264|h\.?264/i.test(title)) return 'H.264';
        if (/av1/i.test(title)) return 'AV1';
        return 'Unknown';
    }

    // Enhanced quality comparison methods
    getQualityRank(quality) {
        if (!quality || quality === 'Unknown') return -1;
        
        // Normalize quality strings
        const normalized = quality.toLowerCase();
        if (normalized.includes('4k') || normalized.includes('uhd')) return 5;
        if (normalized.includes('2160p')) return 4;
        if (normalized.includes('1080p')) return 3;
        if (normalized.includes('720p')) return 2;
        if (normalized.includes('480p')) return 1;
        
        return 0; // Unknown/other quality
    }

    isBetterQuality(newQuality, currentQuality, preferredQuality) {
        const newRank = this.getQualityRank(newQuality);
        const currentRank = this.getQualityRank(currentQuality);
        const preferredRank = this.getQualityRank(preferredQuality);
        
        // If new quality is better than current and doesn't exceed preferred (unless current is below preferred)
        if (newRank > currentRank) {
            // Allow upgrade if current is below preferred, or if new doesn't exceed preferred
            return currentRank < preferredRank || newRank <= preferredRank;
        }
        
        return false;
    }

    async findBestQualityMatch(title, type, preferences) {
        // Get all available matches for this title
        const allMatches = await this.findAllMatchingContent(title, type);
        
        if (allMatches.length === 0) return [];
        
        // Group by cleaned title to find different qualities of same content
        const titleGroups = this.groupByTitle(allMatches);
        const bestMatches = [];
        
        for (const [cleanTitle, matches] of titleGroups.entries()) {
            // Sort by quality rank (best first)
            const sortedMatches = matches.sort((a, b) => {
                const rankA = this.getQualityRank(a.quality);
                const rankB = this.getQualityRank(b.quality);
                return rankB - rankA; // Descending order
            });
            
            // Find the best match within preferences
            const preferredRank = this.getQualityRank(preferences.quality);
            let bestMatch = null;
            
            for (const match of sortedMatches) {
                const matchRank = this.getQualityRank(match.quality);
                
                // Prefer exact match to preferred quality
                if (matchRank === preferredRank) {
                    bestMatch = match;
                    break;
                }
                
                // Otherwise, take the best quality that doesn't exceed preferred
                if (matchRank <= preferredRank) {
                    bestMatch = match;
                    break;
                }
            }
            
            // If no match within preferred quality, take the best available if preferences allow
            if (!bestMatch && preferences.allowHigherQuality) {
                bestMatch = sortedMatches[0]; // Highest quality available
            }
            
            if (bestMatch && this.matchesPreferences(bestMatch, preferences)) {
                bestMatches.push(bestMatch);
            }
        }
        
        return bestMatches;
    }

    groupByTitle(matches) {
        const groups = new Map();
        
        for (const match of matches) {
            const cleanTitle = this.cleanTitle(match.title);
            if (!groups.has(cleanTitle)) {
                groups.set(cleanTitle, []);
            }
            groups.get(cleanTitle).push(match);
        }
        
        return groups;
    }

    async checkForQualityUpgrades(rdApiKey, preferences) {
        const results = {
            checkedTorrents: 0,
            upgradesFound: 0,
            upgradesAdded: 0,
            errors: []
        };

        try {
            // Get current Real-Debrid torrents
            const torrentsResult = await this.getRealDebridTorrents(rdApiKey);
            if (!torrentsResult.success) {
                results.errors.push('Failed to get current torrents');
                return results;
            }

            const currentTorrents = torrentsResult.data;
            results.checkedTorrents = currentTorrents.length;

            for (const torrent of currentTorrents) {
                if (torrent.status !== 'downloaded') continue;
                
                const currentMetadata = this.extractMetadataFromFilename(torrent.filename);
                const betterMatches = await this.findBetterQualityMatches(
                    currentMetadata.title, 
                    currentMetadata.type, 
                    currentMetadata.quality,
                    preferences
                );

                if (betterMatches.length > 0) {
                    results.upgradesFound += betterMatches.length;
                    
                    if (preferences.autoUpgrade) {
                        for (const match of betterMatches) {
                            const addResult = await this.addMagnetToRealDebrid(rdApiKey, match.magnet);
                            if (addResult.success) {
                                results.upgradesAdded++;
                                
                                // Optionally delete the old torrent
                                if (preferences.deleteOldAfterUpgrade) {
                                    await this.deleteRealDebridTorrent(rdApiKey, torrent.id);
                                }
                            } else {
                                results.errors.push(`Failed to upgrade ${currentMetadata.title}: ${addResult.error}`);
                            }
                        }
                    }
                }
            }
        } catch (error) {
            results.errors.push(`Quality upgrade check error: ${error.message}`);
        }

        return results;
    }

    async findBetterQualityMatches(title, type, currentQuality, preferences) {
        const allMatches = await this.findAllMatchingContent(title, type);
        const betterMatches = [];

        for (const match of allMatches) {
            if (this.isBetterQuality(match.quality, currentQuality, preferences.quality)) {
                if (this.matchesPreferences(match, preferences)) {
                    betterMatches.push(match);
                }
            }
        }

        // Sort by quality (best first) and return top matches
        return betterMatches
            .sort((a, b) => this.getQualityRank(b.quality) - this.getQualityRank(a.quality))
            .slice(0, preferences.maxUpgradeMatches || 3);
    }

    async deleteRealDebridTorrent(apiKey, torrentId) {
        try {
            const response = await this.fetchWithFallback(`${this.rdBaseUrl}/torrents/delete/${torrentId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${apiKey}`
                }
            });
            return response.ok;
        } catch (error) {
            console.error('Error deleting torrent:', error);
            return false;
        }
    }

    extractMetadataFromFilename(filename) {
        return {
            title: this.cleanTitle(filename),
            quality: this.extractQuality(filename),
            size: this.extractSize(filename),
            type: this.detectContentType(filename),
            hdr: this.extractHDRInfo(filename),
            codec: this.extractCodec(filename)
        };
    }

    // Enhanced matching with quality preferences
    matchesPreferences(metadata, preferences) {
        // HDR filtering
        if (preferences.hdrPreference !== undefined && preferences.hdrPreference !== 'any') {
            const isHDRContent = metadata.hdr && metadata.hdr !== 'SDR';
            
            if (preferences.hdrPreference === 'sdr-only' && isHDRContent) {
                return false; // Skip HDR content when SDR-only is selected
            }
            
            if (preferences.hdrPreference === 'hdr-only' && !isHDRContent) {
                return false; // Skip SDR content when HDR-only is selected
            }
            
            if (preferences.hdrPreference === 'hdr-preferred' && !isHDRContent) {
                // HDR preferred but not required - allow SDR but rank lower
                // This is handled in the quality ranking logic
            }
        }

        // Quality matching with upgrade logic
        if (preferences.quality && metadata.quality !== 'Unknown') {
            const metadataRank = this.getQualityRank(metadata.quality);
            const preferredRank = this.getQualityRank(preferences.quality);
            
            // Exact match is always good
            if (metadataRank === preferredRank) {
                return this.matchesOtherPreferences(metadata, preferences);
            }
            
            // Higher quality is ok if preferences allow
            if (metadataRank > preferredRank && !preferences.allowHigherQuality) {
                return false;
            }
            
            // Lower quality is ok if preferences allow
            if (metadataRank < preferredRank && !preferences.allowLowerQuality) {
                return false;
            }
        }

        return this.matchesOtherPreferences(metadata, preferences);
    }

    matchesOtherPreferences(metadata, preferences) {
        // Type preferences
        if (preferences.fileTypes && preferences.fileTypes.length > 0) {
            const hasPreferredType = preferences.fileTypes.some(type => {
                switch (type) {
                    case 'remux':
                        return /remux/i.test(metadata.title);
                    case 'bluray':
                        return /bluray|bdrip/i.test(metadata.title);
                    case 'web':
                        return /web-dl|webrip/i.test(metadata.title);
                    default:
                        return false;
                }
            });
            
            if (!hasPreferredType) {
                return false;
            }
        }

        // Size preferences
        if (preferences.maxSize && metadata.size !== 'Unknown') {
            const sizeInGB = this.convertSizeToGB(metadata.size);
            const maxSizeGB = this.convertSizeToGB(preferences.maxSize);
            if (sizeInGB > maxSizeGB) {
                return false;
            }
        }

        return true;
    }

    convertSizeToGB(sizeString) {
        if (!sizeString || sizeString === 'Unknown') return 0;
        
        const match = sizeString.match(/(\d+(?:\.\d+)?)\s*(GB|MB)/i);
        if (!match) return 0;
        
        const value = parseFloat(match[1]);
        const unit = match[2].toUpperCase();
        
        return unit === 'GB' ? value : value / 1024;
    }

    // Auto-add functionality
    async runAutoAddProcess(rdApiKey, traktToken, preferences) {
        const results = {
            moviesProcessed: 0,
            showsProcessed: 0,
            addedToRD: 0,
            upgradesFound: 0,
            upgradesAdded: 0,
            errors: []
        };

        try {
            // Check for quality upgrades first if enabled
            if (preferences.checkForUpgrades) {
                const upgradeResults = await this.checkForQualityUpgrades(rdApiKey, preferences);
                results.upgradesFound = upgradeResults.upgradesFound;
                results.upgradesAdded = upgradeResults.upgradesAdded;
                results.errors.push(...upgradeResults.errors);
            }

            // Get Trakt watchlists and add new content
            if (preferences.autoAddMovies) {
                const movieWatchlist = await this.getTraktWatchlist(traktToken, 'movies');
                if (movieWatchlist.success) {
                    results.moviesProcessed = movieWatchlist.data.length;
                    
                    for (const item of movieWatchlist.data) {
                        const movieTitle = item.movie.title;
                        const bestMatches = await this.findBestQualityMatch(movieTitle, 'movie', preferences);
                        
                        for (const match of bestMatches) {
                            const addResult = await this.addMagnetToRealDebrid(rdApiKey, match.magnet);
                            if (addResult.success) {
                                results.addedToRD++;
                            } else {
                                results.errors.push(`Failed to add ${movieTitle}: ${addResult.error}`);
                            }
                        }
                    }
                }
            }

            if (preferences.autoAddShows) {
                const showWatchlist = await this.getTraktWatchlist(traktToken, 'shows');
                if (showWatchlist.success) {
                    results.showsProcessed = showWatchlist.data.length;
                    
                    for (const item of showWatchlist.data) {
                        const showTitle = item.show.title;
                        const bestMatches = await this.findBestQualityMatch(showTitle, 'tv', preferences);
                        
                        for (const match of bestMatches) {
                            const addResult = await this.addMagnetToRealDebrid(rdApiKey, match.magnet);
                            if (addResult.success) {
                                results.addedToRD++;
                            } else {
                                results.errors.push(`Failed to add ${showTitle}: ${addResult.error}`);
                            }
                        }
                    }
                }
            }
        } catch (error) {
            results.errors.push(`Auto-add process error: ${error.message}`);
        }

        return results;
    }

    // Enhanced auto-add with separate movie/show preferences
    async runAutoAddProcessSeparate(rdApiKey, traktToken, moviePreferences, showPreferences, globalSettings) {
        const results = {
            moviesProcessed: 0,
            showsProcessed: 0,
            moviesAdded: 0,
            showsAdded: 0,
            movieUpgradesFound: 0,
            showUpgradesFound: 0,
            upgradesAdded: 0,
            errors: []
        };

        try {
            // Check for quality upgrades first if enabled
            if (globalSettings.checkForUpgrades) {
                if (moviePreferences.autoUpgrade) {
                    const movieUpgradeResults = await this.checkForQualityUpgrades(rdApiKey, moviePreferences, 'movie');
                    results.movieUpgradesFound = movieUpgradeResults.upgradesFound;
                    results.upgradesAdded += movieUpgradeResults.upgradesAdded;
                    results.errors.push(...movieUpgradeResults.errors);
                }

                if (showPreferences.autoUpgrade) {
                    const showUpgradeResults = await this.checkForQualityUpgrades(rdApiKey, showPreferences, 'tv');
                    results.showUpgradesFound = showUpgradeResults.upgradesFound;
                    results.upgradesAdded += showUpgradeResults.upgradesAdded;
                    results.errors.push(...showUpgradeResults.errors);
                }
            }

            // Get Trakt watchlists and add new content with type-specific preferences
            if (globalSettings.autoAddMovies) {
                const movieWatchlist = await this.getTraktWatchlist(traktToken, 'movies');
                if (movieWatchlist.success) {
                    results.moviesProcessed = movieWatchlist.data.length;
                    
                    for (const item of movieWatchlist.data) {
                        const movieTitle = item.movie.title;
                        const movieYear = item.movie.year;
                        const bestMatches = await this.findBestQualityMatch(
                            movieTitle, 
                            'movie', 
                            moviePreferences,
                            movieYear
                        );
                        
                        for (const match of bestMatches) {
                            const addResult = await this.addMagnetToRealDebrid(rdApiKey, match.magnet);
                            if (addResult.success) {
                                results.moviesAdded++;
                            } else {
                                results.errors.push(`Failed to add ${movieTitle}: ${addResult.error}`);
                            }
                        }
                    }
                }
            }

            if (globalSettings.autoAddShows) {
                const showWatchlist = await this.getTraktWatchlist(traktToken, 'shows');
                if (showWatchlist.success) {
                    results.showsProcessed = showWatchlist.data.length;
                    
                    for (const item of showWatchlist.data) {
                        const showTitle = item.show.title;
                        const showYear = item.show.year;
                        const bestMatches = await this.findBestQualityMatchForShow(
                            showTitle, 
                            showPreferences,
                            showYear
                        );
                        
                        for (const match of bestMatches) {
                            const addResult = await this.addMagnetToRealDebrid(rdApiKey, match.magnet);
                            if (addResult.success) {
                                results.showsAdded++;
                            } else {
                                results.errors.push(`Failed to add ${showTitle}: ${addResult.error}`);
                            }
                        }
                    }
                }
            }
        } catch (error) {
            results.errors.push(`Auto-add process error: ${error.message}`);
        }

        return results;
    }

    async findBestQualityMatchForShow(showTitle, preferences, year = null) {
        // Get all available matches for this show
        const allMatches = await this.findAllMatchingContent(showTitle, 'tv');
        
        if (allMatches.length === 0) return [];
        
        // Filter matches based on show-specific preferences
        const filteredMatches = allMatches.filter(match => {
            // Check if it matches show preferences
            if (!this.matchesPreferences(match, preferences)) {
                return false;
            }

            // Show-specific filtering
            if (preferences.completeSeasons) {
                // Prefer complete season packs
                if (/complete|season|s\d{2}/i.test(match.title)) {
                    return true;
                }
                // Skip individual episodes if complete seasons are preferred
                if (/s\d{2}e\d{2}/i.test(match.title)) {
                    return false;
                }
            }

            return true;
        });

        // Group by season/episode structure
        const seasonGroups = this.groupShowsBySeasonStructure(filteredMatches);
        const bestMatches = [];

        for (const [groupKey, matches] of seasonGroups.entries()) {
            // Sort by quality rank (best first)
            const sortedMatches = matches.sort((a, b) => {
                const rankA = this.getQualityRank(a.quality);
                const rankB = this.getQualityRank(b.quality);
                return rankB - rankA; // Descending order
            });
            
            // Find the best match within preferences
            const preferredRank = this.getQualityRank(preferences.quality);
            let bestMatch = null;
            
            for (const match of sortedMatches) {
                const matchRank = this.getQualityRank(match.quality);
                
                // Prefer exact match to preferred quality
                if (matchRank === preferredRank) {
                    bestMatch = match;
                    break;
                }
                
                // Otherwise, take the best quality that doesn't exceed preferred
                if (matchRank <= preferredRank) {
                    bestMatch = match;
                    break;
                }
            }
            
            // If no match within preferred quality, take the best available if preferences allow
            if (!bestMatch && preferences.allowHigherQuality) {
                bestMatch = sortedMatches[0]; // Highest quality available
            }
            
            if (bestMatch) {
                bestMatches.push(bestMatch);
            }
        }
        
        return bestMatches;
    }

    groupShowsBySeasonStructure(matches) {
        const groups = new Map();
        
        for (const match of matches) {
            let groupKey = this.cleanTitle(match.title);
            
            // Extract season information for grouping
            const seasonMatch = match.title.match(/s(\d{2})/i);
            const episodeMatch = match.title.match(/s\d{2}e(\d{2})/i);
            
            if (seasonMatch) {
                const seasonNum = seasonMatch[1];
                if (episodeMatch) {
                    // Individual episode
                    groupKey = `${groupKey}_S${seasonNum}_Individual`;
                } else {
                    // Season pack
                    groupKey = `${groupKey}_S${seasonNum}_Pack`;
                }
            } else {
                // Complete series or unclear structure
                groupKey = `${groupKey}_Complete`;
            }
            
            if (!groups.has(groupKey)) {
                groups.set(groupKey, []);
            }
            groups.get(groupKey).push(match);
        }
        
        return groups;
    }

    async checkForQualityUpgrades(rdApiKey, preferences, contentType = null) {
        const results = {
            checkedTorrents: 0,
            upgradesFound: 0,
            upgradesAdded: 0,
            errors: []
        };

        try {
            // Get current Real-Debrid torrents
            const torrentsResult = await this.getRealDebridTorrents(rdApiKey);
            if (!torrentsResult.success) {
                results.errors.push('Failed to get current torrents');
                return results;
            }

            const currentTorrents = torrentsResult.data;
            
            // Filter torrents by content type if specified
            let filteredTorrents = currentTorrents;
            if (contentType) {
                filteredTorrents = currentTorrents.filter(torrent => {
                    const metadata = this.extractMetadataFromFilename(torrent.filename);
                    return metadata.type === contentType;
                });
            }
            
            results.checkedTorrents = filteredTorrents.length;

            for (const torrent of filteredTorrents) {
                if (torrent.status !== 'downloaded') continue;
                
                const currentMetadata = this.extractMetadataFromFilename(torrent.filename);
                const betterMatches = await this.findBetterQualityMatches(
                    currentMetadata.title, 
                    currentMetadata.type, 
                    currentMetadata.quality,
                    preferences
                );

                if (betterMatches.length > 0) {
                    results.upgradesFound += betterMatches.length;
                    
                    if (preferences.autoUpgrade) {
                        for (const match of betterMatches) {
                            const addResult = await this.addMagnetToRealDebrid(rdApiKey, match.magnet);
                            if (addResult.success) {
                                results.upgradesAdded++;
                                
                                // Optionally delete the old torrent
                                if (preferences.deleteOldAfterUpgrade) {
                                    await this.deleteRealDebridTorrent(rdApiKey, torrent.id);
                                }
                            } else {
                                results.errors.push(`Failed to upgrade ${currentMetadata.title}: ${addResult.error}`);
                            }
                        }
                    }
                }
            }
        } catch (error) {
            results.errors.push(`Quality upgrade check error: ${error.message}`);
        }

        return results;
    }

    // Enhanced metadata extraction with HDR detection
    extractMetadataFromMagnet(magnetLink) {
        const params = new URLSearchParams(magnetLink.split('?')[1]);
        const displayName = params.get('dn') || '';
        
        return {
            title: this.cleanTitle(displayName),
            quality: this.extractQuality(displayName),
            size: this.extractSize(displayName),
            type: this.detectContentType(displayName),
            hdr: this.extractHDRInfo(displayName),
            codec: this.extractCodec(displayName)
        };
    }

    extractHDRInfo(title) {
        const hdrTypes = {
            dolbyVision: /dolby.?vision|dv/i.test(title),
            hdr10Plus: /hdr10\+/i.test(title),
            hdr10: /hdr10(?!\+)/i.test(title),
            hdr: /\bhdr\b/i.test(title) && !/hdr10/i.test(title)
        };

        if (hdrTypes.dolbyVision) return 'Dolby Vision';
        if (hdrTypes.hdr10Plus) return 'HDR10+';
        if (hdrTypes.hdr10) return 'HDR10';
        if (hdrTypes.hdr) return 'HDR';
        
        return 'SDR'; // Standard Dynamic Range
    }

    extractCodec(title) {
        if (/x265|hevc|h\.?265/i.test(title)) return 'HEVC';
        if (/x264|h\.?264/i.test(title)) return 'H.264';
        if (/av1/i.test(title)) return 'AV1';
        return 'Unknown';
    }

    extractMetadataFromFilename(filename) {
        return {
            title: this.cleanTitle(filename),
            quality: this.extractQuality(filename),
            size: this.extractSize(filename),
            type: this.detectContentType(filename),
            hdr: this.extractHDRInfo(filename),
            codec: this.extractCodec(filename)
        };
    }

    // Enhanced matching with HDR preferences
    matchesPreferences(metadata, preferences) {
        // HDR filtering
        if (preferences.hdrPreference !== undefined && preferences.hdrPreference !== 'any') {
            const isHDRContent = metadata.hdr && metadata.hdr !== 'SDR';
            
            if (preferences.hdrPreference === 'sdr-only' && isHDRContent) {
                return false; // Skip HDR content when SDR-only is selected
            }
            
            if (preferences.hdrPreference === 'hdr-only' && !isHDRContent) {
                return false; // Skip SDR content when HDR-only is selected
            }
            
            if (preferences.hdrPreference === 'hdr-preferred' && !isHDRContent) {
                // HDR preferred but not required - allow SDR but rank lower
                // This is handled in the quality ranking logic
            }
        }

        // Quality matching with upgrade logic
        if (preferences.quality && metadata.quality !== 'Unknown') {
            const metadataRank = this.getQualityRank(metadata.quality);
            const preferredRank = this.getQualityRank(preferences.quality);
            
            // Exact match is always good
            if (metadataRank === preferredRank) {
                return this.matchesOtherPreferences(metadata, preferences);
            }
            
            // Higher quality is ok if preferences allow
            if (metadataRank > preferredRank && !preferences.allowHigherQuality) {
                return false;
            }
            
            // Lower quality is ok if preferences allow
            if (metadataRank < preferredRank && !preferences.allowLowerQuality) {
                return false;
            }
        }

        return this.matchesOtherPreferences(metadata, preferences);
    }

    matchesOtherPreferences(metadata, preferences) {
        // Type preferences
        if (preferences.fileTypes && preferences.fileTypes.length > 0) {
            const hasPreferredType = preferences.fileTypes.some(type => {
                switch (type) {
                    case 'remux':
                        return /remux/i.test(metadata.title);
                    case 'bluray':
                        return /bluray|bdrip/i.test(metadata.title);
                    case 'web':
                        return /web-dl|webrip/i.test(metadata.title);
                    default:
                        return false;
                }
            });
            
            if (!hasPreferredType) {
                return false;
            }
        }

        // Size preferences
        if (preferences.maxSize && metadata.size !== 'Unknown') {
            const sizeInGB = this.convertSizeToGB(metadata.size);
            const maxSizeGB = this.convertSizeToGB(preferences.maxSize);
            if (sizeInGB > maxSizeGB) {
                return false;
            }
        }

        return true;
    }
}

// Export the API manager
window.APIManager = APIManager;