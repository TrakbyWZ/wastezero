using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;
using System.Text.Json;
using WasteZero.WindowsUploadService.Configuration;

namespace WasteZero.WindowsUploadService.Services;

public sealed class UploadBackgroundService : BackgroundService
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IOptions<UploadServiceOptions> _options;
    private readonly IUploadStateStore _state;
    private readonly ILogger<UploadBackgroundService> _logger;
    private readonly IHostEnvironment _env;

    public UploadBackgroundService(
        IHttpClientFactory httpClientFactory,
        IOptions<UploadServiceOptions> options,
        IUploadStateStore state,
        ILogger<UploadBackgroundService> logger,
        IHostEnvironment env)
    {
        _httpClientFactory = httpClientFactory;
        _options = options;
        _state = state;
        _logger = logger;
        _env = env;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var o = _options.Value;
        var resolvedDirs = ValidateDirectories(o.WatchDirectories);
        var dbPath = Path.GetFullPath(
            Path.IsPathRooted(o.DatabasePath) ? o.DatabasePath : Path.Combine(_env.ContentRootPath, o.DatabasePath));
        _state.EnsureDatabase(dbPath);

        _logger.LogInformation(
            "Service started. WatchDirectories={Dirs}, ApiEndpoint={Api}, PollingIntervalSeconds={Poll}, DatabasePath={Db}, LogDir={Log}",
            o.WatchDirectories,
            o.ApiEndpoint,
            o.PollingIntervalSeconds,
            dbPath,
            o.LogDir);

        var interval = TimeSpan.FromSeconds(Math.Max(5, o.PollingIntervalSeconds));
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await RunCycleAsync(resolvedDirs, stoppingToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Poll cycle error");
            }

            try
            {
                await Task.Delay(interval, stoppingToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
        }
    }

    private List<string> ValidateDirectories(IReadOnlyList<string> watchDirectories)
    {
        var invalid = new List<string>();
        var resolved = new List<string>();
        foreach (var dir in watchDirectories)
        {
            var resolvedPath = Path.GetFullPath(dir);
            try
            {
                var attr = File.GetAttributes(resolvedPath);
                if ((attr & FileAttributes.Directory) == 0)
                    invalid.Add(dir);
                else
                    resolved.Add(resolvedPath);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Watch path not accessible: {Dir}", dir);
                invalid.Add(dir);
            }
        }

        if (invalid.Count > 0)
            throw new InvalidOperationException(
                $"The following paths are not accessible or not directories: {string.Join(", ", invalid)}");

        return resolved;
    }

    private async Task RunCycleAsync(List<string> resolvedDirs, CancellationToken ct)
    {
        var o = _options.Value;
        _state.TrimState(o.MaxStateRecords, o.MaxStateAgeDays);

        var logFiles = LogDirectoryScanner.ScanForLogFiles(resolvedDirs, _logger);
        var toSend = logFiles
            .Select(p => Path.GetFullPath(p))
            .Where(p => _state.IsEligibleForUpload(p))
            .ToList();

        _logger.LogInformation(
            "Poll cycle. TotalFiles={Total}, AlreadyHandled={Handled}, ToUpload={ToUpload}, Files={Files}",
            logFiles.Count,
            logFiles.Count - toSend.Count,
            toSend.Count,
            toSend.Count > 0 ? string.Join(", ", toSend.Select(Path.GetFileName)) : null);

        var client = _httpClientFactory.CreateClient();
        client.Timeout = TimeSpan.FromMinutes(5);

        foreach (var filePath in toSend)
        {
            ct.ThrowIfCancellationRequested();
            var normalized = Path.GetFullPath(filePath);
            _logger.LogInformation("Attempting to upload {File}", normalized);

            try
            {
                var content = await ReadAllTextWithRetryAsync(normalized, ct).ConfigureAwait(false);
                var filename = Path.GetFileName(normalized);
                var (ok, status, body) = await PostIngestAsync(client, o, content, filename, ct).ConfigureAwait(false);

                if (ok || status is 200 or 201)
                {
                    _state.MarkSent(normalized, filename);
                    _logger.LogInformation("Upload successful for {File} status={Status}", normalized, status);
                }
                else
                {
                    var reason = string.IsNullOrEmpty(body) ? $"HTTP {status}" : body[..Math.Min(body.Length, 200)];
                    if (DuplicateResponseClassifier.IsDuplicateFilenameError(body))
                    {
                        _state.MarkSkipped(normalized, filename, reason);
                        _logger.LogInformation(
                            "File already exists on server (will not retry) {File} status={Status} reason={Reason}",
                            normalized,
                            status,
                            reason);
                    }
                    else
                    {
                        _state.MarkFailed(normalized, filename, reason, 60_000);
                        var isVercelAuth = status == 401
                                           && o.ApiEndpoint.Contains("vercel.app", StringComparison.OrdinalIgnoreCase)
                                           && (body.Contains("Authentication Required", StringComparison.Ordinal)
                                               || body.Contains("vercel", StringComparison.OrdinalIgnoreCase))
                                           && string.IsNullOrWhiteSpace(o.VercelProtectionBypass);

                        if (isVercelAuth)
                        {
                            _logger.LogError(
                                "Upload failed (will retry in 60s) {File} status={Status} body={Body}. Hint: set vercelProtectionBypass or VERCEL_PROTECTION_BYPASS for Vercel deployment protection.",
                                normalized,
                                status,
                                Truncate(body, 500));
                        }
                        else
                        {
                            _logger.LogError(
                                "Upload failed (will retry in 60s) {File} status={Status} body={Body}",
                                normalized,
                                status,
                                Truncate(body, 500));
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                _state.MarkFailed(normalized, Path.GetFileName(normalized), ex.Message, 60_000);
                _logger.LogError(ex, "Upload error (will retry in 60s) for {File}", normalized);
            }
        }
    }

    private static async Task<string> ReadAllTextWithRetryAsync(string path, CancellationToken ct)
    {
        for (var attempt = 0; attempt <= 5; attempt++)
        {
            try
            {
                return await File.ReadAllTextAsync(path, Encoding.UTF8, ct).ConfigureAwait(false);
            }
            catch (IOException) when (attempt < 5)
            {
                await Task.Delay(400, ct).ConfigureAwait(false);
            }
        }

        throw new IOException("Could not read file after retries.");
    }

    private static async Task<(bool ok, int status, string body)> PostIngestAsync(
        HttpClient client,
        UploadServiceOptions o,
        string content,
        string filename,
        CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post, o.ApiEndpoint);
        req.Headers.TryAddWithoutValidation("X-API-Key", o.ApiKey);
        if (!string.IsNullOrWhiteSpace(o.VercelProtectionBypass))
            req.Headers.TryAddWithoutValidation("x-vercel-protection-bypass", o.VercelProtectionBypass.Trim());

        req.Content = JsonContent.Create(
            new IngestBody { Content = content, Filename = filename },
            mediaType: null,
            new JsonSerializerOptions { PropertyNamingPolicy = null });

        req.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json") { CharSet = "utf-8" };

        using var res = await client.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct).ConfigureAwait(false);
        var body = await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        return (res.IsSuccessStatusCode, (int)res.StatusCode, body);
    }

    private static string Truncate(string s, int max) =>
        s.Length <= max ? s : s[..max];

    private sealed class IngestBody
    {
        [JsonPropertyName("content")]
        public string Content { get; set; } = "";

        [JsonPropertyName("filename")]
        public string Filename { get; set; } = "";
    }
}
