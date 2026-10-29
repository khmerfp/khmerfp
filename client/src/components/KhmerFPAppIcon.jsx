import React from "react";

export default function KhmerFPAppIcon() {
  return (
    <div style={styles.page}>
      <div style={styles.icon}>
        <div style={styles.goldAccent} />
        <div style={styles.logo}>
          <span>K</span>
          <span style={styles.arrow}>➜</span>
        </div>
        <div style={styles.brand}>KhmerFP</div>
      </div>

      <h2>KhmerFP App Icon</h2>
      <p>1024 × 1024 app icon preview</p>

      <button
        style={styles.button}
        onClick={() => window.print()}
      >
        Save preview as PDF
      </button>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "Arial, sans-serif",
    gap: "12px",
    background: "#f1f5f9",
  },
  icon: {
    width: "min(80vw, 420px)",
    aspectRatio: "1 / 1",
    borderRadius: "22%",
    background: "linear-gradient(145deg, #153e90, #071a46)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    overflow: "hidden",
    color: "#ffffff",
    boxShadow: "0 16px 40px #0f172a33",
  },
  goldAccent: {
    position: "absolute",
    width: "65%",
    height: "65%",
    border: "5px solid #e8b84b",
    borderRadius: "50%",
    opacity: 0.65,
  },
  logo: {
    display: "flex",
    alignItems: "center",
    fontSize: "clamp(64px, 15vw, 120px)",
    fontWeight: 900,
    zIndex: 1,
  },
  arrow: {
    color: "#e8b84b",
    fontSize: "0.5em",
    marginLeft: "-8px",
  },
  brand: {
    fontSize: "clamp(22px, 5vw, 34px)",
    fontWeight: 700,
    letterSpacing: "1px",
    marginTop: "12px",
    zIndex: 1,
  },
  button: {
    padding: "12px 20px",
    background: "#153e90",
    color: "#fff",
    border: 0,
    borderRadius: "8px",
    cursor: "pointer",
  },
};
