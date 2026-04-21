using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using System.Security.Claims;
using System.Security.Cryptography;

var builder = WebApplication.CreateBuilder(new WebApplicationOptions {
    Args = args,
    ContentRootPath = AppContext.BaseDirectory,
    WebRootPath = "wwwroot"
});

// Налаштування сервісів та бази даних
builder.Services.AddDbContext<AppDbContext>(o => o.UseSqlite("Data Source=tournaments.db"));
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(opt => {
        opt.Cookie.Name     = "tp_session";
        opt.Cookie.HttpOnly = true;
        opt.Cookie.SameSite = SameSiteMode.Lax;
        opt.ExpireTimeSpan  = TimeSpan.FromDays(7);
        opt.Events.OnRedirectToLogin       = ctx => { ctx.Response.StatusCode = 401; return Task.CompletedTask; };
        opt.Events.OnRedirectToAccessDenied = ctx => { ctx.Response.StatusCode = 403; return Task.CompletedTask; };
    });
builder.Services.AddAuthorization();

var app = builder.Build();

// Ініціалізація бази даних
using (var scope = app.Services.CreateScope()) {
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    db.Database.EnsureCreated();
    db.Database.ExecuteSqlRaw(@"CREATE TABLE IF NOT EXISTS ""Users"" (
        ""Id""           INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        ""Name""         TEXT NOT NULL DEFAULT '',
        ""Email""        TEXT NOT NULL DEFAULT '',
        ""PasswordHash"" TEXT NOT NULL DEFAULT '',
        ""Role""         TEXT NOT NULL DEFAULT 'Team',
        ""TeamId""       INTEGER NULL
    )");
    if (!db.Users.Any()) {
        db.Users.AddRange(
            new User { Name = "Адміністратор", Email = "admin@role.com", PasswordHash = HashPass("admin123"), Role = "Admin" },
            new User { Name = "Журі",           Email = "jury@role.com",  PasswordHash = HashPass("jury123"),  Role = "Jury"  }
        );
        db.SaveChanges();
    }
}

// Обробка статичних файлів (Frontend)
app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions {
    OnPrepareResponse = ctx => {
        ctx.Context.Response.Headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
        ctx.Context.Response.Headers["Pragma"]  = "no-cache";
        ctx.Context.Response.Headers["Expires"] = "0";
    }
});

app.UseAuthentication();
app.UseAuthorization();

// Аутентифікація
app.MapGet("/api/auth/me", (HttpContext ctx) => {
    if (ctx.User.Identity?.IsAuthenticated != true) return Results.Ok(new { authenticated = false });
    return Results.Ok(new {
        authenticated = true,
        id     = int.Parse(ctx.User.FindFirstValue(ClaimTypes.NameIdentifier)!),
        name   = ctx.User.FindFirstValue(ClaimTypes.Name),
        email  = ctx.User.FindFirstValue(ClaimTypes.Email),
        role   = ctx.User.FindFirstValue(ClaimTypes.Role),
        teamId = ctx.User.FindFirstValue("TeamId") is string tid ? (int?)int.Parse(tid) : null
    });
});

app.MapPost("/api/auth/login", async (LoginDto req, AppDbContext db, HttpContext ctx) => {
    var user = await db.Users.FirstOrDefaultAsync(u => u.Email.ToLower() == req.Email.ToLower());
    if (user == null || !VerifyPass(req.Password, user.PasswordHash))
        return Results.BadRequest(new { message = "Невірний email або пароль." });
    await DoSignIn(ctx, user);
    return Results.Ok(new { id = user.Id, name = user.Name, email = user.Email, role = user.Role, teamId = user.TeamId });
});

app.MapPost("/api/auth/logout", async (HttpContext ctx) => {
    await ctx.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
    return Results.Ok();
});

app.MapPost("/api/auth/register-team", async (RegisterDto req, AppDbContext db, HttpContext ctx) => {
    if (await db.Users.AnyAsync(u => u.Email.ToLower() == req.Email.ToLower()))
        return Results.BadRequest(new { message = "Користувач з таким email вже існує." });
    if (await db.Users.AnyAsync(u => u.Name.ToLower() == req.Name.ToLower()))
        return Results.BadRequest(new { message = "Користувач з таким ПІБ вже зареєстрований." });
    var user = new User { Name = req.Name, Email = req.Email, PasswordHash = HashPass(req.Password), Role = "Team" };
    db.Users.Add(user);
    await db.SaveChangesAsync();
    await DoSignIn(ctx, user);
    return Results.Ok(new { id = user.Id, name = user.Name, email = user.Email, role = user.Role, teamId = user.TeamId });
});

// Ендпоінти для Турнірів
app.MapGet("/api/tournaments", async (AppDbContext db) => await db.Tournaments.ToListAsync());

app.MapPost("/api/tournaments", async (Tournament t, AppDbContext db, HttpContext ctx) => {
    if (!ctx.User.IsInRole("Admin")) return Results.Forbid();
    db.Tournaments.Add(t);
    await db.SaveChangesAsync();
    return Results.Created($"/api/tournaments/{t.Id}", t);
});

app.MapPatch("/api/tournaments/{id}/status", async (int id, string status, AppDbContext db, HttpContext ctx) => {
    if (!ctx.User.IsInRole("Admin")) return Results.Forbid();
    var t = await db.Tournaments.FindAsync(id);
    if (t == null) return Results.NotFound();
    t.Status = status;
    await db.SaveChangesAsync();
    return Results.Ok(t);
});

// Ендпоінти для Команд
app.MapGet("/api/teams", async (AppDbContext db) => await db.Teams.ToListAsync());
app.MapGet("/api/teams/{tournamentId}", async (int tournamentId, AppDbContext db) =>
    await db.Teams.Where(t => t.TournamentId == tournamentId).ToListAsync());

app.MapPost("/api/teams", async (Team team, AppDbContext db, HttpContext ctx) => {
    if (!ctx.User.IsInRole("Team")) return Results.Forbid();
    var userId = int.Parse(ctx.User.FindFirstValue(ClaimTypes.NameIdentifier)!);
    var tour = await db.Tournaments.FindAsync(team.TournamentId);
    if (tour == null) return Results.NotFound();
    if (DateTime.UtcNow > tour.RegistrationEnd)
        return Results.BadRequest(new { message = "Термін реєстрації закінчився. Нові команди не приймаються." });
    if (tour.MaxTeams.HasValue) {
        var teamCount = await db.Teams.CountAsync(t => t.TournamentId == team.TournamentId);
        if (teamCount >= tour.MaxTeams.Value)
            return Results.BadRequest(new { message = $"Досягнуто максимальну кількість команд ({tour.MaxTeams.Value})." });
    }
    if (await db.Teams.AnyAsync(t => t.TournamentId == team.TournamentId && t.Name.ToLower() == team.Name.ToLower()))
        return Results.BadRequest(new { message = "Команда з таким іменем вже існує!" });
    var user = await db.Users.FindAsync(userId);
    team.CaptainEmail = user!.Email;
    if (string.IsNullOrWhiteSpace(team.CaptainName)) team.CaptainName = user.Name;
    if (await db.Teams.AnyAsync(t => t.TournamentId == team.TournamentId && t.CaptainEmail.ToLower() == team.CaptainEmail.ToLower()))
        return Results.BadRequest(new { message = "Ця електронна пошта вже зареєстрована в цьому турнірі!" });
    db.Teams.Add(team);
    await db.SaveChangesAsync();
    user.TeamId = team.Id;
    await db.SaveChangesAsync();
    await DoSignIn(ctx, user);
    return Results.Ok(team);
});

// Ендпоінти для Раундів
app.MapGet("/api/rounds/{tournamentId}", async (int tournamentId, AppDbContext db) =>
    await db.Rounds.Where(r => r.TournamentId == tournamentId).ToListAsync());

app.MapPost("/api/rounds", async (Round round, AppDbContext db, HttpContext ctx) => {
    if (!ctx.User.IsInRole("Admin")) return Results.Forbid();
    db.Rounds.Add(round);
    await db.SaveChangesAsync();
    return Results.Ok(round);
});

// Ендпоінти для Подачі робіт (Подачі)
app.MapGet("/api/submissions", async (AppDbContext db, int? tournamentId) => {
    var rounds = await db.Rounds.ToListAsync();
    var teams  = await db.Teams.ToListAsync();
    var subs   = await db.Submissions.ToListAsync();
    if (tournamentId.HasValue) {
        var ids = rounds.Where(r => r.TournamentId == tournamentId.Value).Select(r => r.Id).ToHashSet();
        subs = subs.Where(s => ids.Contains(s.RoundId)).ToList();
    }
    return subs.Select(s => new {
        s.Id, s.RoundId, s.TeamId, s.GithubUrl, s.VideoUrl, s.Description, s.Timestamp, s.LastModified,
        TeamName  = teams.FirstOrDefault(t => t.Id == s.TeamId)?.Name  ?? "Команда",
        RoundName = rounds.FirstOrDefault(r => r.Id == s.RoundId)?.Name ?? "Раунд"
    });
});

app.MapPost("/api/submissions", async (Submission sub, AppDbContext db, HttpContext ctx) => {
    if (!ctx.User.IsInRole("Team")) return Results.Forbid();
    var round = await db.Rounds.FindAsync(sub.RoundId);
    if (round == null) return Results.NotFound();
    var tour = await db.Tournaments.FindAsync(round.TournamentId);
    if (tour == null) return Results.NotFound();
    if (tour.Status == "Registration")
        return Results.BadRequest(new { message = "Подача недоступна на етапі реєстрації." });
    if (tour.Status == "Finished")
        return Results.BadRequest(new { message = "Турнір завершено. Подача неможлива." });
    if (DateTime.UtcNow > round.Deadline)
        return Results.BadRequest(new { message = $"Дедлайн раунду «{round.Name}» минув. Зміни недоступні." });
    var now = DateTime.UtcNow;
    var existing = await db.Submissions.FirstOrDefaultAsync(s => s.RoundId == sub.RoundId && s.TeamId == sub.TeamId);
    if (existing != null) {
        existing.GithubUrl    = sub.GithubUrl;
        existing.VideoUrl     = sub.VideoUrl;
        existing.Description  = sub.Description;
        existing.LastModified = now;
    } else {
        sub.Timestamp    = now;
        sub.LastModified = now;
        db.Submissions.Add(sub);
    }
    await db.SaveChangesAsync();
    return Results.Ok(existing ?? sub);
});

// Ендпоінти для Оцінювання (Оцінки)
app.MapGet("/api/evaluations", async (AppDbContext db) => await db.Evaluations.ToListAsync());
app.MapGet("/api/evaluations/{submissionId}", async (int submissionId, AppDbContext db) =>
    await db.Evaluations.Where(e => e.SubmissionId == submissionId).ToListAsync());

app.MapPost("/api/evaluations", async (Evaluation eval, AppDbContext db, HttpContext ctx) => {
    if (!ctx.User.IsInRole("Jury")) return Results.Forbid();
    var ex = await db.Evaluations.FirstOrDefaultAsync(e => e.SubmissionId == eval.SubmissionId);
    if (ex != null) {
        ex.TechScore          = eval.TechScore;
        ex.FunctionalityScore = eval.FunctionalityScore;
        ex.Comment            = eval.Comment;
    } else {
        db.Evaluations.Add(eval);
    }
    await db.SaveChangesAsync();
    return Results.Ok(eval);
});

// Ендпоінти для Таблиці лідерів (Таблиця)
app.MapGet("/api/leaderboard/{tournamentId}", async (int tournamentId, AppDbContext db) => {
    var teams  = await db.Teams.Where(t => t.TournamentId == tournamentId).ToListAsync();
    var subs   = await db.Submissions.ToListAsync();
    var evals  = await db.Evaluations.ToListAsync();
    var result = teams.Select(team => {
        var subIds  = subs.Where(s => s.TeamId == team.Id).Select(s => s.Id).ToList();
        var myEvals = evals.Where(e => subIds.Contains(e.SubmissionId)).ToList();
        bool hasEvals = myEvals.Any();
        double score  = hasEvals ? myEvals.Average(e => (e.TechScore + e.FunctionalityScore) / 2.0) : 0;
        return new { team.Name, Score = score, HasEvaluations = hasEvals, team.Id };
    }).OrderByDescending(r => r.HasEvaluations).ThenByDescending(r => r.Score);
    return Results.Ok(result);
});

// Ендпоінти для Оголошень (Оголошення)
app.MapGet("/api/announcements/{tournamentId}", async (int tournamentId, AppDbContext db) =>
    await db.Announcements.Where(a => a.TournamentId == tournamentId).OrderByDescending(a => a.CreatedAt).ToListAsync());

app.MapPost("/api/announcements", async (Announcement ann, AppDbContext db, HttpContext ctx) => {
    if (!ctx.User.IsInRole("Admin")) return Results.Forbid();
    ann.CreatedAt = DateTime.UtcNow;
    db.Announcements.Add(ann);
    await db.SaveChangesAsync();
    return Results.Ok(ann);
});

app.MapDelete("/api/announcements/{id}", async (int id, AppDbContext db, HttpContext ctx) => {
    if (!ctx.User.IsInRole("Admin")) return Results.Forbid();
    var ann = await db.Announcements.FindAsync(id);
    if (ann == null) return Results.NotFound();
    db.Announcements.Remove(ann);
    await db.SaveChangesAsync();
    return Results.Ok();
});

app.Run();

// Хешування паролів (PBKDF2, вбудований у .NET)
static string HashPass(string pwd) {
    var salt = RandomNumberGenerator.GetBytes(16);
    var hash = Rfc2898DeriveBytes.Pbkdf2(pwd, salt, 100_000, HashAlgorithmName.SHA256, 32);
    return Convert.ToBase64String(salt) + ":" + Convert.ToBase64String(hash);
}

static bool VerifyPass(string pwd, string stored) {
    var parts = stored.Split(':');
    if (parts.Length != 2) return false;
    var salt = Convert.FromBase64String(parts[0]);
    var hash = Rfc2898DeriveBytes.Pbkdf2(pwd, salt, 100_000, HashAlgorithmName.SHA256, 32);
    return CryptographicOperations.FixedTimeEquals(hash, Convert.FromBase64String(parts[1]));
}

static async Task DoSignIn(HttpContext ctx, User user) {
    var claims = new List<Claim> {
        new(ClaimTypes.NameIdentifier, user.Id.ToString()),
        new(ClaimTypes.Name,  user.Name),
        new(ClaimTypes.Email, user.Email),
        new(ClaimTypes.Role,  user.Role),
    };
    if (user.TeamId.HasValue) claims.Add(new("TeamId", user.TeamId.Value.ToString()));
    var identity = new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme);
    await ctx.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, new ClaimsPrincipal(identity));
}

// Моделі даних та Контекст БД
public class User {
    public int    Id           { get; set; }
    public string Name         { get; set; } = "";
    public string Email        { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public string Role         { get; set; } = "Team";
    public int?   TeamId       { get; set; }
}

public record LoginDto(string Email, string Password);
public record RegisterDto(string Name, string Email, string Password);

public class Tournament {
    public int       Id                { get; set; }
    public string    Name              { get; set; } = "";
    public string    Description       { get; set; } = "";
    public string    Status            { get; set; } = "Registration";
    public DateTime  RegistrationStart { get; set; }
    public DateTime  RegistrationEnd   { get; set; }
    public int?      MaxTeams          { get; set; }
    public DateTime? EndDate           { get; set; }
    public DateTime? ResultsDate       { get; set; }
}

public class Team {
    public int    Id           { get; set; }
    public int    TournamentId { get; set; }
    public string Name         { get; set; } = "";
    public string CaptainName  { get; set; } = "";
    public string CaptainEmail { get; set; } = "";
    public string Members      { get; set; } = "";
}

public class Round {
    public int      Id           { get; set; }
    public int      TournamentId { get; set; }
    public string   Name         { get; set; } = "";
    public string   Description  { get; set; } = "";
    public string   Requirements { get; set; } = "";
    public DateTime Deadline     { get; set; }
}

public class Submission {
    public int       Id           { get; set; }
    public int       RoundId      { get; set; }
    public int       TeamId       { get; set; }
    public string    GithubUrl    { get; set; } = "";
    public string    VideoUrl     { get; set; } = "";
    public string    Description  { get; set; } = "";
    public DateTime  Timestamp    { get; set; }
    public DateTime? LastModified { get; set; }
}

public class Evaluation {
    public int    Id                 { get; set; }
    public int    SubmissionId       { get; set; }
    public string JuryName           { get; set; } = "";
    public int    TechScore          { get; set; }
    public int    FunctionalityScore { get; set; }
    public string Comment            { get; set; } = "";
}

public class Announcement {
    public int      Id           { get; set; }
    public int      TournamentId { get; set; }
    public string   Content      { get; set; } = "";
    public DateTime CreatedAt    { get; set; }
}

public class AppDbContext : DbContext {
    public AppDbContext(DbContextOptions<AppDbContext> o) : base(o) { }
    public DbSet<User>         Users         => Set<User>();
    public DbSet<Tournament>   Tournaments   => Set<Tournament>();
    public DbSet<Team>         Teams         => Set<Team>();
    public DbSet<Round>        Rounds        => Set<Round>();
    public DbSet<Submission>   Submissions   => Set<Submission>();
    public DbSet<Evaluation>   Evaluations   => Set<Evaluation>();
    public DbSet<Announcement> Announcements => Set<Announcement>();
}
