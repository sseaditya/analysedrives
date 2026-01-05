# AnalyseDrive - Metrics & Formulae Reference

This document outlines the mathematical models and logic used to calculate the various metrics displayed throughout the application.

---

## 1. Core Geographic Calculations

### distance (Haversine Formula)
Used to calculate the shortest distance between two points on a sphere (Earth).
- **Formula**: 
  - $a = \sin^2(\Delta\phi/2) + \cos \phi_1 \cdot \cos \phi_2 \cdot \sin^2(\Delta\lambda/2)$
  - $c = 2 \cdot \operatorname{atan2}(\sqrt{a}, \sqrt{1-a})$
  - $d = R \cdot c$
- **Units**: Kilometers (km)
- **Constants**: Earth Radius ($R$) = 6371 km

### Bearing (Heading)
Calculates the forward azimuth between two GPS points.
- **Formula**:
  - $\theta = \operatorname{atan2}(\sin \Delta\lambda \cdot \cos \phi_2, \cos \phi_1 \cdot \sin \phi_2 - \sin \phi_1 \cdot \cos \phi_2 \cdot \cos \Delta\lambda)$
- **Units**: Degrees (0-360°)

---

## 2. Motion & Speed Metrics

### Speed
Calculated per segment between two consecutive points.
- **Formula**: $v = d / \Delta t$
- **Filtering**: Segments exceeding 200 km/h are rejected as GPS jitter.
- **Smoothing**: A 5-point Simple Moving Average (SMA) is applied to raw speeds to eliminate transients.

### Hard Acceleration / Braking
- **Acceleration ($a$)**: $\Delta v / \Delta t$ (using smoothed velocity)
- **Hard Accel**: $a > 2.5 \, \text{m/s}^2$
- **Hard Braking**: $a < -3.0 \, \text{m/s}^2$

### Accel→Brake Turbulence Score
Quantifies "jerkiness" or instability in the ride.
- **Formula**: $\frac{\sum |\text{accel}_i - \text{accel}_{i-1}|}{N} \cdot 10$
- **Logic**: Sum of absolute differences in acceleration between segments, normalized by point count.

### Motion Time Profile
Categorizes every second of the activity:
- **Stopped**: Speed < 5.0 km/h
- **Accelerating**: Accel > 0.2 m/s²
- **Braking**: Accel < -0.2 m/s²
- **Cruising**: All other moving time.

---

## 3. Elevation & Terrain Metrics

### Elevation Gain / Loss
- **Gain**: $\sum (\text{ele}_i - \text{ele}_{i-1})$ where difference > 0.
- **Loss**: $\sum |\text{ele}_i - \text{ele}_{i-1}|$ where difference < 0.

### Hilliness Score
Quantifies route intensity.
- **Formula**: $\frac{\text{Total Elevation Gain (m)}}{\text{Total Distance (km)}}$

### Steepest Climb / Descent (%)
- **Formula**: $\max(\frac{\Delta \text{ele}}{\Delta \text{dist} \cdot 1000} \cdot 100)$
- **Requirement**: Only segments > 5m are considered to filter altitude jitter.

### VAM (Vertical Ascent Meters)
Climbing efficiency.
- **Formula**: $\frac{\text{Total Elevation Gain (m)}}{\text{Moving Time (hours)}}$

---

## 4. Route Geometry Metrics

### Total Heading Change
The absolute sum of all directional changes.
- **Formula**: $\sum |\text{bearing}_i - \text{bearing}_{i-1}|$ (adjusted for the 360° wrap)

### Twistiness Score
- **Formula**: $\frac{\text{Total Heading Change (degrees)}}{\text{Total Distance (km)}}$

### Straight Section Logic
- **Straight**: A contiguous sequence of points where the heading change per segment is $< 5^\circ$.
- **Requirement**: Minimum distance of 20m to be classified as a "straight section."
- **Percent Straight**: $\frac{\text{Sum of straight distances}}{\text{Total activity distance}} \cdot 100$

---

## 5. Stop Detection
- **Logic**: A "Stop" is registered if the speed remains below 5.0 km/h for a continuous duration of at least 10 seconds.
