// C interface to TetGen for WebAssembly: one mesh at a time, results held until the next call
#include "tetgen.h"
#include <cstdio>

static tetgenio out;

extern "C" {

// Tetrahedralizes a closed triangle surface; each triangle's marker is carried to the boundary faces.
// Returns 0 on success, otherwise TetGen's error code (or -1 for an unknown failure).
int tg_tetrahedralize(const char *switches, int pointCount, const double *points,
                      int triangleCount, const int *triangles, const int *markers) {
  out.clean_memory();
  out.initialize();
  tetgenio in;
  in.firstnumber = 0;
  in.numberofpoints = pointCount;
  in.pointlist = new REAL[3 * pointCount];
  for (int i = 0; i < 3 * pointCount; i++) in.pointlist[i] = points[i];
  in.numberoffacets = triangleCount;
  in.facetlist = new tetgenio::facet[triangleCount];
  in.facetmarkerlist = new int[triangleCount];
  for (int t = 0; t < triangleCount; t++) {
    tetgenio::facet *f = &in.facetlist[t];
    tetgenio::init(f);
    f->numberofpolygons = 1;
    f->polygonlist = new tetgenio::polygon[1];
    tetgenio::polygon *p = &f->polygonlist[0];
    tetgenio::init(p);
    p->numberofvertices = 3;
    p->vertexlist = new int[3];
    for (int k = 0; k < 3; k++) p->vertexlist[k] = triangles[3 * t + k];
    in.facetmarkerlist[t] = markers[t];
  }
  try {
    tetgenbehavior b;
    if (!b.parse_commandline(const_cast<char *>(switches))) return 10;
    tetrahedralize(&b, &in, &out);
  } catch (int code) {
    return code;
  } catch (...) {
    return -1;
  }
  return 0;
}

int tg_point_count() { return out.numberofpoints; }
double *tg_points() { return out.pointlist; }
int tg_tet_count() { return out.numberoftetrahedra; }
int tg_corners_per_tet() { return out.numberofcorners; }
int *tg_tets() { return out.tetrahedronlist; }
int tg_face_count() { return out.numberoftrifaces; }
int *tg_faces() { return out.trifacelist; }
int *tg_face_markers() { return out.trifacemarkerlist; }

}
