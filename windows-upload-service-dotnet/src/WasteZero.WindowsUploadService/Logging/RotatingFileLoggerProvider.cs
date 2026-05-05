using System.Collections.Concurrent;
using System.Text;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using WasteZero.WindowsUploadService.Configuration;

namespace WasteZero.WindowsUploadService.Logging;

public sealed class RotatingFileLoggerProvider : ILoggerProvider
{
    private readonly IOptions<UploadServiceOptions> _options;
    private readonly string _contentRoot;
    private readonly ConcurrentDictionary<string, RotatingFileLogger> _loggers = new();

    public RotatingFileLoggerProvider(IOptions<UploadServiceOptions> options, IHostEnvironment hostEnvironment)
    {
        _options = options;
        _contentRoot = hostEnvironment.ContentRootPath;
    }

    public ILogger CreateLogger(string categoryName) =>
        _loggers.GetOrAdd(categoryName, _ => new RotatingFileLogger(this));

    public void Dispose()
    {
        _loggers.Clear();
    }

    internal void Write(LogLevel level, EventId eventId, string message, Exception? exception)
    {
        var o = _options.Value;
        var logDir = Path.GetFullPath(Path.IsPathRooted(o.LogDir) ? o.LogDir : Path.Combine(_contentRoot, o.LogDir));
        Directory.CreateDirectory(logDir);
        var file = Path.Combine(logDir, "service.log");
        var ts = DateTimeOffset.UtcNow.ToString("O");
        var meta = exception != null ? $" {exception}" : "";
        var line = $"{ts} [{level}] {message}{meta}{Environment.NewLine}";
        var bytes = Encoding.UTF8.GetBytes(line);

        for (var attempt = 0; attempt <= 5; attempt++)
        {
            try
            {
                RotateIfNeeded(file, o.LogMaxSizeBytes, o.LogMaxBackups);
                using var stream = new FileStream(file, FileMode.Append, FileAccess.Write, FileShare.ReadWrite);
                stream.Write(bytes);
                stream.Flush();
                return;
            }
            catch (IOException) when (attempt < 5)
            {
                Thread.Sleep(400);
            }
        }
    }

    private static void RotateIfNeeded(string logPath, long maxSizeBytes, int maxBackups)
    {
        if (maxSizeBytes <= 0 || maxBackups < 0 || !File.Exists(logPath))
            return;

        try
        {
            var info = new FileInfo(logPath);
            if (info.Length < maxSizeBytes)
                return;
        }
        catch
        {
            return;
        }

        if (maxBackups < 1)
        {
            try { File.Delete(logPath); } catch { /* ignore */ }
            return;
        }

        for (var i = maxBackups; i >= 1; i--)
        {
            var dst = $"{logPath}.{i}";
            var src = i == 1 ? logPath : $"{logPath}.{i - 1}";
            try
            {
                if (i == maxBackups && File.Exists(dst))
                    File.Delete(dst);
                if (File.Exists(src))
                    File.Move(src, dst, overwrite: true);
            }
            catch
            {
                // best-effort rotation
            }
        }
    }
}

internal sealed class RotatingFileLogger : ILogger
{
    private readonly RotatingFileLoggerProvider _provider;

    public RotatingFileLogger(RotatingFileLoggerProvider provider) => _provider = provider;

    public IDisposable BeginScope<TState>(TState state) => NullScope.Instance;

    public bool IsEnabled(LogLevel logLevel) => logLevel != LogLevel.None;

    public void Log<TState>(
        LogLevel logLevel,
        EventId eventId,
        TState state,
        Exception? exception,
        Func<TState, Exception?, string> formatter)
    {
        if (!IsEnabled(logLevel))
            return;

        var message = formatter(state, exception);
        _provider.Write(logLevel, eventId, message, exception);
    }
}

internal sealed class NullScope : IDisposable
{
    public static readonly NullScope Instance = new();
    public void Dispose() { }
}
