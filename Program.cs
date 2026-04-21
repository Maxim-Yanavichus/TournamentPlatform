using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Authorization;

var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    Args = args,
    ContentRootPath = AppContext.BaseDirectory,
    WebRootPath = "wwwroot"
});

// Налаштування JWT
var jwtKey = "super-secret-key-that-is-at-least-thirty-two-characters-long";
var key = Encoding.ASCII.GetBytes(jwtKey);

builder.Services.AddAuthentication(x =>
{
    x.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
    x.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
})
.AddJwtBearer(x =>
{
    x.RequireHttpsMetadata = false;
    x.SaveToken = true;
    x.TokenValidationParameters = new TokenValidationParameters
    {
        ValidateIssuerSigningKey = true,
        IssuerSigningKey = new SymmetricSecurityKey(key),
        ValidateIssuer = false,
        ValidateAudience = false
    };
});

builder.Services.AddAuthorization();

// Налаштування сервісів та бази даних
builder.Services.AddDbContext<AppDbContext>(o => o.UseSqlite("Data Source=tournaments.db"));
var app = builder.Build();

// Ініціалізація бази даних
using (var scope = app.Services.CreateScope()) {
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    db.Database.EnsureCreated();
    
    // Створення дефолтних користувачів, якщо їх немає
    if (!db.Users.Any()) {
        db.Users.Add(new User { Username = "admin", Password = "123", Role = "Admin" });
        db.Users.Add(new User { Username = "jury",  Password = "123", Role = "Jury" });
        db.SaveChanges();
    }
}

app.UseAuthentication();
app.UseAuthorization();

// Обробка статичних файлів (Frontend)
app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions {
    OnPrepareResponse = ctx => {
        ctx.Context.Response.Headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
        ctx.Context.Response.Headers["Pragma"] = "no-cache";
        ctx.Context.Response.Headers["Expires"] = "0";
    }
});

// ─── Авторизація ─────────────────────────────────────────────────────────────

app.MapPost("/api/auth/login", async (LoginRequest req, AppDbContext db) => {
    var user = await db.Users.FirstOrDefaultAsync(u => u.Username == req.Username && u.Password == req.Password);
    if (user == null) return Results.Unauthorized();

    var tokenHandler = new JwtSecurityTokenHandler();
    var tokenDescriptor = new SecurityTokenDescriptor
    {
        Subject = new ClaimsIdentity(new[] { 
            new Claim(ClaimTypes.Name, user.Username),
            new Claim(ClaimTypes.Role, user.Role),
            new Claim("TeamId", user.TeamId?.ToString() ?? "")
        }),
        Expires = DateTime.UtcNow.AddDays(7),
        SigningCredentials = new SigningCredentials(new SymmetricSecurityKey(key), SecurityAlgorithms.HmacSha256Signature)
    };
    var token = tokenHandler.CreateToken(tokenDescriptor);
    return Results.Ok(new { token = tokenHandler.WriteToken(token), role = user.Role, teamId = user.TeamId, username = user.Username });
});

// ─── Ендпоінти для Турнірів ──────────────────────────────────────────────────
app.MapGet("/api/tournaments", async (AppDbContext db) => await db.Tournaments.ToListAsync());

app.MapPost("/api/tournaments", [Authorize(Roles = "Admin")] async (Tournament t, AppDbContext db) => {
    db.Tournaments.Add(t);
    await db.SaveChangesAsync();
    return Results.Created($"/api/tournaments/{t.Id}", t);
});

app.MapPatch("/api/tournaments/{id}/status", [Authorize(Roles = "Admin")] async (int id, string status, AppDbContext db) => {
    var t = await db.Tournaments.FindAsync(id);
    if (t == null) return Results.NotFound();
    t.Status = status;
    await db.SaveChangesAsync();
    return Results.Ok(t);
});

// ─── Ендпоінти для Команд ────────────────────────────────────────────────────
app.MapGet("/api/teams", async (AppDbContext db) => await db.Teams.ToListAsync());
app.MapGet("/api/teams/{tournamentId}", async (int tournamentId, AppDbContext db) =>
    await db.Teams.Where(t => t.TournamentId == tournamentId).ToListAsync());

app.MapPost("/api/teams", async (Team team, AppDbContext db) => {
    var tour = await db.Tournaments.FindAsync(team.TournamentId);
    if (tour == null) return Results.NotFound();
    if (DateTime.UtcNow > tour.RegistrationEnd)
        return Results.BadRequest(new { message = "Термін реєстрації закінчився. Нові команди не приймаються." });
    
    if (await db.Teams.AnyAsync(t => t.TournamentId == team.TournamentId && t.Name == team.Name))
        return Results.BadRequest(new { message = "Команда з таким іменем вже існує!" });
    
    if (await db.Teams.AnyAsync(t => t.TournamentId == team.TournamentId && t.CaptainEmail.ToLower() == team.CaptainEmail.ToLower()))
        return Results.BadRequest(new { message = "Ця електронна пошта вже зареєстрована в цьому турнірі!" });

    // При реєстрації команди автоматично створюємо користувача
    var user = new User { 
        Username = team.Name, 
        Password = "123", // В реалі треба хешувати та давати вводити
        Role = "Team" 
    };
    db.Users.Add(user);
    db.Teams.Add(team);
    await db.SaveChangesAsync();
    
    user.TeamId = team.Id;
    await db.SaveChangesAsync();

    return Results.Ok(team);
});

// ─── Ендпоінти для Раундів ───────────────────────────────────────────────────
app.MapGet("/api/rounds/{tournamentId}", async (int tournamentId, AppDbContext db) =>
    await db.Rounds.Where(r => r.TournamentId == tournamentId).ToListAsync());

app.MapPost("/api/rounds", [Authorize(Roles = "Admin")] async (Round round, AppDbContext db) => {
    db.Rounds.Add(round);
    await db.SaveChangesAsync();
    return Results.Ok(round);
});

// ─── Ендпоінти для Подачі робіт (Submissions) ────────────────────────────────
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
        TeamName = teams.FirstOrDefault(t => t.Id == s.TeamId)?.Name ?? "Команда",
        RoundName = rounds.FirstOrDefault(r => r.Id == s.RoundId)?.Name ?? "Раунд"
    });
});

app.MapPost("/api/submissions", [Authorize(Roles = "Team")] async (Submission sub, AppDbContext db, ClaimsPrincipal user) => {
    var teamIdClaim = user.FindFirst("TeamId")?.Value;
    if (string.IsNullOrEmpty(teamIdClaim) || int.Parse(teamIdClaim) != sub.TeamId)
        return Results.Forbid();

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
        existing.GithubUrl = sub.GithubUrl;
        existing.VideoUrl  = sub.VideoUrl;
        existing.Description = sub.Description;
        existing.LastModified = now;
    } else {
        sub.Timestamp = now;
        sub.LastModified = now;
        db.Submissions.Add(sub);
    }
    await db.SaveChangesAsync();
    return Results.Ok(existing ?? sub);
});

// ─── Ендпоінти для Оцінювання (Evaluations) ──────────────────────────────────
app.MapGet("/api/evaluations", async (AppDbContext db) => await db.Evaluations.ToListAsync());
app.MapGet("/api/evaluations/{submissionId}", async (int submissionId, AppDbContext db) =>
    await db.Evaluations.Where(e => e.SubmissionId == submissionId).ToListAsync());

app.MapPost("/api/evaluations", [Authorize(Roles = "Jury")] async (Evaluation eval, AppDbContext db) => {
    var ex = await db.Evaluations.FirstOrDefaultAsync(e => e.SubmissionId == eval.SubmissionId);
    if (ex != null) {
        ex.TechScore = eval.TechScore;
        ex.FunctionalityScore = eval.FunctionalityScore;
        ex.Comment = eval.Comment;
    } else {
        db.Evaluations.Add(eval);
    }
    await db.SaveChangesAsync();
    return Results.Ok(eval);
});

// ─── Ендпоінти для Таблиці лідерів (Leaderboard) ─────────────────────────────
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

// ─── Ендпоінти для Оголошень (Announcements) ─────────────────────────────────
app.MapGet("/api/announcements/{tournamentId}", async (int tournamentId, AppDbContext db) =>
    await db.Announcements.Where(a => a.TournamentId == tournamentId).OrderByDescending(a => a.CreatedAt).ToListAsync());

app.MapPost("/api/announcements", [Authorize(Roles = "Admin")] async (Announcement ann, AppDbContext db) => {
    ann.CreatedAt = DateTime.UtcNow;
    db.Announcements.Add(ann);
    await db.SaveChangesAsync();
    return Results.Ok(ann);
});

app.MapDelete("/api/announcements/{id}", [Authorize(Roles = "Admin")] async (int id, AppDbContext db) => {
    var ann = await db.Announcements.FindAsync(id);
    if (ann == null) return Results.NotFound();
    db.Announcements.Remove(ann);
    await db.SaveChangesAsync();
    return Results.Ok();
});

app.Run();

// ─── Моделі даних та Контекст БД ─────────────────────────────────────────────

public record LoginRequest(string Username, string Password);

public class User {
    public int Id { get; set; }
    public string Username { get; set; } = "";
    public string Password { get; set; } = ""; // В реальному проекті тут має бути PasswordHash
    public string Role { get; set; } = "Team";
    public int? TeamId { get; set; }
}

public class Tournament {
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public string Status { get; set; } = "Registration";
    public DateTime RegistrationStart { get; set; }
    public DateTime RegistrationEnd { get; set; }
    public int? MaxTeams { get; set; }
    public DateTime? EndDate { get; set; }
    public DateTime? ResultsDate { get; set; }
}

public class Team {
    public int Id { get; set; }
    public int TournamentId { get; set; }
    public string Name { get; set; } = "";
    public string CaptainName { get; set; } = "";
    public string CaptainEmail { get; set; } = "";
    public string Members { get; set; } = "";
}

public class Round {
    public int Id { get; set; }
    public int TournamentId { get; set; }
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public string Requirements { get; set; } = "";
    public DateTime Deadline { get; set; }
}

public class Submission {
    public int Id { get; set; }
    public int RoundId { get; set; }
    public int TeamId { get; set; }
    public string GithubUrl { get; set; } = "";
    public string VideoUrl { get; set; } = "";
    public string Description { get; set; } = "";
    public DateTime Timestamp { get; set; }
    public DateTime? LastModified { get; set; }
}

public class Evaluation {
    public int Id { get; set; }
    public int SubmissionId { get; set; }
    public string JuryName { get; set; } = "";
    public int TechScore { get; set; }
    public int FunctionalityScore { get; set; }
    public string Comment { get; set; } = "";
}

public class Announcement {
    public int Id { get; set; }
    public int TournamentId { get; set; }
    public string Content { get; set; } = "";
    public DateTime CreatedAt { get; set; }
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
