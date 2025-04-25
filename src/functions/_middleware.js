/**
 * Middleware function for Cloudflare Pages
 * Retrieves GitHub repository information including last update time
 */

// Cache settings
const CACHE_TIME = 60 * 60; // 1 hour in seconds
const CACHE_CONTROL = `public, max-age=${CACHE_TIME}`;

// GitHub API endpoint
const GITHUB_API_BASE = 'https://api.github.com';
const USER_AGENT = 'YackSuite-Tool-Status-Checker';

/**
 * Handles request to get repository information
 * @param {string} repoFullName - Repository full name (owner/repo)
 * @returns {Promise<Object>} Repository information including last update time
 */
async function getRepoInfo(repoFullName, githubToken) {
  try {
    // Replace GitHub domain with API url if full GitHub URL was provided
    let repoPath = repoFullName;
    if (repoPath.includes('github.com/')) {
      repoPath = repoPath.replace(/https?:\/\/github\.com\//, '');
    }

    // Remove trailing slash and .git suffix if present
    repoPath = repoPath.replace(/\.git$/, '').replace(/\/$/, '');

    // For paths that include a branch or subdirectory, extract just the repo part
    if (repoPath.includes('/tree/')) {
      repoPath = repoPath.split('/tree/')[0];
    }

    // Fetch repo info
    const repoResponse = await fetch(`${GITHUB_API_BASE}/repos/${repoPath}`, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `Bearer ${githubToken}`
      }
    });

    if (!repoResponse.ok) {
      throw new Error(`GitHub API error: ${repoResponse.status}`);
    }

    const repoData = await repoResponse.json();

    // Get the latest commit for the default branch
    const commitsResponse = await fetch(`${GITHUB_API_BASE}/repos/${repoPath}/commits?per_page=1&sha=${repoData.default_branch}`, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `Bearer ${githubToken}`
      }
    });

    if (!commitsResponse.ok) {
      throw new Error(`GitHub API error fetching commits: ${commitsResponse.status}`);
    }

    const commits = await commitsResponse.json();

    return {
      name: repoData.name,
      full_name: repoData.full_name,
      description: repoData.description,
      url: repoData.html_url,
      stars: repoData.stargazers_count,
      forks: repoData.forks_count,
      last_updated: commits[0]?.commit?.committer?.date || repoData.updated_at,
      last_commit_message: commits[0]?.commit?.message || '',
      last_commit_url: commits[0]?.html_url || '',
      owner: {
        login: repoData.owner.login,
        avatar_url: repoData.owner.avatar_url,
        url: repoData.owner.html_url
      }
    };
  } catch (error) {
    console.error(`Error fetching repo info for ${repoFullName}:`, error);
    return {
      name: repoFullName,
      error: error.message,
      last_updated: null
    };
  }
}

/**
 * Middleware function to handle all requests
 */
export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const githubToken = env.GITHUB_TOKEN;

  // Handle bulk repo info requests
  if (url.pathname === '/api/repos-info') {
    try {
      if (request.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed. Use POST.' }), {
          status: 405,
          headers: {
            'Content-Type': 'application/json',
            'Allow': 'POST'
          }
        });
      }

      // Parse request body
      const body = await request.json();
      const { repos } = body;

      if (!repos || !Array.isArray(repos)) {
        return new Response(JSON.stringify({ error: 'Invalid request. Provide an array of repo URLs.' }), {
          status: 400,
          headers: {
            'Content-Type': 'application/json'
          }
        });
      }

      // Fetch info for all repos in parallel
      const repoInfoPromises = repos.map(repo => getRepoInfo(repo, githubToken));
      const repoInfoResults = await Promise.all(repoInfoPromises);

      // Create a map of repo URL to info
      const repoInfoMap = {};
      repos.forEach((repo, index) => {
        repoInfoMap[repo] = repoInfoResults[index];
      });

      return new Response(JSON.stringify(repoInfoMap), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': CACHE_CONTROL
        }
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }
  }

  // For single repo requests
  if (url.pathname === '/api/repo-info') {
    try {
      const repoUrl = url.searchParams.get('repo');

      if (!repoUrl) {
        return new Response(JSON.stringify({ error: 'Missing repo parameter' }), {
          status: 400,
          headers: {
            'Content-Type': 'application/json'
          }
        });
      }

      const repoInfo = await getRepoInfo(repoUrl);

      return new Response(JSON.stringify(repoInfo), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': CACHE_CONTROL
        }
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }
  }

  // Pass through to the next handler for all other requests
  return next();
}
